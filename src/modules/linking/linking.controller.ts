import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { emitToUser } from "../../shared/services/socket";
import { requestAccessSchema, inviteDoctorSchema } from "./linking.schema";

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

export class LinkingController {
  // ─── Doctor: request access to a patient ────────────────────────────────────

  static async requestAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const { patientEmail } = requestAccessSchema.parse(req.body);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const patientUser = await prisma.user.findUnique({
        where: { email: patientEmail },
        include: { patient: true },
      });
      if (!patientUser || patientUser.role !== "PATIENT" || !patientUser.patient) {
        throw new AppError(404, "No patient account found with that email", "PATIENT_NOT_FOUND");
      }

      const patient = patientUser.patient;

      const existing = await prisma.patientDoctorLink.findUnique({
        where: { patientId_doctorId: { patientId: patient.id, doctorId: doctor.id } },
      });

      if (existing) {
        if (existing.status === "APPROVED") throw new AppError(409, "You already have access to this patient", "ALREADY_LINKED");
        if (existing.status === "PENDING") throw new AppError(409, "A request is already pending", "REQUEST_PENDING");
        // DENIED/REVOKED/EXPIRED — allow re-request by updating
        const updated = await prisma.patientDoctorLink.update({
          where: { id: existing.id },
          data: { status: "PENDING", initiatedBy: "DOCTOR", requestedAt: new Date(), respondedAt: null, revokedAt: null },
        });
        await LinkingController._notifyPatient(patient.userId, doctor.fullName, updated.id);
        return res.status(200).json({ success: true, message: "Access re-requested", data: updated });
      }

      const link = await prisma.patientDoctorLink.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          initiatedBy: "DOCTOR",
          status: "PENDING",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      await LinkingController._notifyPatient(patient.userId, doctor.fullName, link.id);

      res.status(201).json({ success: true, message: "Access request sent", data: link });
    } catch (err) {
      next(err);
    }
  }

  // ─── Patient: invite a doctor ────────────────────────────────────────────────

  static async inviteDoctor(req: Request, res: Response, next: NextFunction) {
    try {
      const { doctorEmail } = inviteDoctorSchema.parse(req.body);

      const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });
      if (!patient) throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");

      const doctorUser = await prisma.user.findUnique({
        where: { email: doctorEmail },
        include: { doctor: true },
      });
      if (!doctorUser || doctorUser.role !== "DOCTOR" || !doctorUser.doctor) {
        throw new AppError(404, "No doctor account found with that email", "DOCTOR_NOT_FOUND");
      }

      const doctor = doctorUser.doctor;

      const existing = await prisma.patientDoctorLink.findUnique({
        where: { patientId_doctorId: { patientId: patient.id, doctorId: doctor.id } },
      });

      if (existing) {
        if (existing.status === "APPROVED") throw new AppError(409, "This doctor already has access", "ALREADY_LINKED");
        if (existing.status === "PENDING") throw new AppError(409, "A request is already pending", "REQUEST_PENDING");
        const updated = await prisma.patientDoctorLink.update({
          where: { id: existing.id },
          data: { status: "APPROVED", initiatedBy: "PATIENT", respondedAt: new Date(), revokedAt: null },
        });
        await LinkingController._notifyDoctor(doctorUser.id, patient.fullName, updated.id);
        return res.status(200).json({ success: true, message: "Doctor invited and access granted", data: updated });
      }

      // Patient-initiated links auto-approve (patient is granting access)
      const link = await prisma.patientDoctorLink.create({
        data: {
          patientId: patient.id,
          doctorId: doctor.id,
          initiatedBy: "PATIENT",
          status: "APPROVED",
          respondedAt: new Date(),
        },
      });

      await LinkingController._notifyDoctor(doctorUser.id, patient.fullName, link.id);

      res.status(201).json({ success: true, message: "Doctor added successfully", data: link });
    } catch (err) {
      next(err);
    }
  }

  // ─── Shared: list links ──────────────────────────────────────────────────────

  static async getLinks(req: Request, res: Response, next: NextFunction) {
    try {
      const { role, id: userId } = req.user!;

      if (role === "DOCTOR") {
        const doctor = await prisma.doctor.findUnique({ where: { userId } });
        if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

        const links = await prisma.patientDoctorLink.findMany({
          where: { doctorId: doctor.id },
          include: {
            patient: {
              select: { id: true, fullName: true, avatarUrl: true, user: { select: { email: true } } },
            },
          },
          orderBy: { requestedAt: "desc" },
        });
        return res.json({ success: true, data: links });
      }

      // PATIENT
      const patient = await prisma.patient.findUnique({ where: { userId } });
      if (!patient) throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");

      const links = await prisma.patientDoctorLink.findMany({
        where: { patientId: patient.id },
        include: {
          doctor: {
            select: {
              id: true,
              fullName: true,
              specialisation: true,
              licenceVerified: true,
              avatarUrl: true,
              consultationFee: true,
              user: { select: { email: true } },
            },
          },
        },
        orderBy: { requestedAt: "desc" },
      });
      res.json({ success: true, data: links });
    } catch (err) {
      next(err);
    }
  }

  // ─── Patient: approve / deny ─────────────────────────────────────────────────

  static async approveLink(req: Request, res: Response, next: NextFunction) {
    try {
      const link = await LinkingController._getPatientLink(p(req.params.id), req.user!.id);

      if (link.status !== "PENDING") {
        throw new AppError(400, "Only pending requests can be approved", "INVALID_STATUS");
      }

      const updated = await prisma.patientDoctorLink.update({
        where: { id: link.id },
        data: { status: "APPROVED", respondedAt: new Date() },
        include: { patient: { select: { fullName: true } }, doctor: { include: { user: true } } },
      });

      emitToUser(updated.doctor.userId, "link:approved", {
        linkId: link.id,
        patientName: updated.patient.fullName,
      });

      await prisma.notification.create({
        data: {
          userId: updated.doctor.userId,
          type: "ACCESS_APPROVED",
          title: "Access Approved",
          body: `${updated.patient.fullName} approved your access request.`,
        },
      });

      res.json({ success: true, message: "Access approved", data: updated });
    } catch (err) {
      next(err);
    }
  }

  static async denyLink(req: Request, res: Response, next: NextFunction) {
    try {
      const link = await LinkingController._getPatientLink(p(req.params.id), req.user!.id);

      if (link.status !== "PENDING") {
        throw new AppError(400, "Only pending requests can be denied", "INVALID_STATUS");
      }

      const updated = await prisma.patientDoctorLink.update({
        where: { id: link.id },
        data: { status: "DENIED", respondedAt: new Date() },
        include: { patient: { select: { fullName: true } }, doctor: { include: { user: true } } },
      });

      emitToUser(updated.doctor.userId, "link:denied", { linkId: link.id });

      await prisma.notification.create({
        data: {
          userId: updated.doctor.userId,
          type: "ACCESS_REVOKED",
          title: "Access Denied",
          body: `${updated.patient.fullName} denied your access request.`,
        },
      });

      res.json({ success: true, message: "Access denied", data: updated });
    } catch (err) {
      next(err);
    }
  }

  // ─── Shared: revoke / remove link ────────────────────────────────────────────

  static async revokeLink(req: Request, res: Response, next: NextFunction) {
    try {
      const linkId = p(req.params.id);
      const { role, id: userId } = req.user!;

      let link;
      if (role === "PATIENT") {
        link = await LinkingController._getPatientLink(linkId, userId);
      } else {
        const doctor = await prisma.doctor.findUnique({ where: { userId } });
        if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");
        link = await prisma.patientDoctorLink.findFirst({
          where: { id: linkId, doctorId: doctor.id },
        });
        if (!link) throw new AppError(404, "Link not found", "NOT_FOUND");
      }

      const updated = await prisma.patientDoctorLink.update({
        where: { id: link!.id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });

      res.json({ success: true, message: "Access revoked", data: updated });
    } catch (err) {
      next(err);
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private static async _getPatientLink(linkId: string, userId: string) {
    const patient = await prisma.patient.findUnique({ where: { userId } });
    if (!patient) throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");

    const link = await prisma.patientDoctorLink.findFirst({
      where: { id: linkId, patientId: patient.id },
    });
    if (!link) throw new AppError(404, "Link not found", "NOT_FOUND");
    return link;
  }

  private static async _notifyPatient(patientUserId: string, doctorName: string, linkId: string) {
    await prisma.notification.create({
      data: {
        userId: patientUserId,
        type: "ACCESS_REQUEST",
        title: "New Access Request",
        body: `Dr. ${doctorName} is requesting access to your medical records.`,
        data: { linkId },
      },
    });
    emitToUser(patientUserId, "link:request", { linkId, doctorName });
  }

  private static async _notifyDoctor(doctorUserId: string, patientName: string, linkId: string) {
    await prisma.notification.create({
      data: {
        userId: doctorUserId,
        type: "ACCESS_APPROVED",
        title: "Patient Added You",
        body: `${patientName} has added you as their doctor.`,
        data: { linkId },
      },
    });
    emitToUser(doctorUserId, "link:approved", { linkId, patientName });
  }
}
