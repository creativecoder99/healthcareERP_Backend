import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { generateSignedUrl } from "../../shared/services/s3";
import { updateDoctorSchema, createNoteSchema } from "./doctor.schema";

// Express 5 route params are typed `string | string[]`; named params are always a single string at runtime.
const p = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

export class DoctorController {
  // ─── Profile ────────────────────────────────────────────────────────────────

  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await prisma.doctor.findUnique({
        where: { userId: req.user!.id },
        include: { organisation: true },
      });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      res.json({ success: true, data: doctor });
    } catch (err) {
      next(err);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const validated = updateDoctorSchema.parse(req.body);

      const updated = await prisma.doctor.update({ where: { id: doctor.id }, data: validated });

      res.json({ success: true, message: "Profile updated", data: updated });
    } catch (err) {
      next(err);
    }
  }

  // ─── Linked Patients ─────────────────────────────────────────────────────────

  static async getLinkedPatients(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const links = await prisma.patientDoctorLink.findMany({
        where: { doctorId: doctor.id, status: "APPROVED" },
        include: {
          patient: {
            include: {
              user: { select: { email: true } },
              medicalRecords: {
                where: { deletedAt: null },
                orderBy: { uploadedAt: "desc" },
                take: 1,
                select: { uploadedAt: true },
              },
            },
          },
        },
        orderBy: { respondedAt: "desc" },
      });

      const patients = links.map((link) => ({
        linkId: link.id,
        accessScope: link.accessScope,
        linkedSince: link.respondedAt,
        patient: {
          id: link.patient.id,
          fullName: link.patient.fullName,
          email: link.patient.user.email,
          dateOfBirth: link.patient.dateOfBirth,
          gender: link.patient.gender,
          bloodGroup: link.patient.bloodGroup,
          avatarUrl: link.patient.avatarUrl,
          lastUpload: link.patient.medicalRecords[0]?.uploadedAt ?? null,
        },
      }));

      res.json({ success: true, data: patients });
    } catch (err) {
      next(err);
    }
  }

  static async getPatientDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "You do not have access to this patient", "ACCESS_DENIED");

      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        include: { user: { select: { email: true, createdAt: true } } },
      });
      if (!patient) throw new AppError(404, "Patient not found", "NOT_FOUND");

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          actorRole: "DOCTOR",
          action: "VIEW_PATIENT_PROFILE",
          resourceType: "PatientProfile",
          resourceId: patientId,
          ipAddress: req.ip ?? null,
        },
      });

      res.json({ success: true, data: patient });
    } catch (err) {
      next(err);
    }
  }

  static async getPatientRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);
      const { type, page = "1", limit = "20" } = req.query as Record<string, string>;

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "You do not have access to this patient", "ACCESS_DENIED");

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const skip = (pageNum - 1) * limitNum;

      const where: Record<string, unknown> = { patientId, deletedAt: null };
      if (type) where.recordType = type;
      if (link.accessScope === "SELECTED" && link.scopeRecordIds.length > 0) {
        where.id = { in: link.scopeRecordIds };
      }

      const [records, total] = await Promise.all([
        prisma.medicalRecord.findMany({
          where,
          orderBy: { uploadedAt: "desc" },
          skip,
          take: limitNum,
          select: {
            id: true, fileName: true, recordType: true, recordDate: true,
            fileSize: true, mimeType: true, processingStatus: true,
            uploadedAt: true, facilityName: true,
          },
        }),
        prisma.medicalRecord.count({ where }),
      ]);

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          actorRole: "DOCTOR",
          action: "LIST_PATIENT_RECORDS",
          resourceType: "PatientProfile",
          resourceId: patientId,
          ipAddress: req.ip ?? null,
        },
      });

      res.json({
        success: true,
        data: { records, pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) } },
      });
    } catch (err) {
      next(err);
    }
  }

  static async getPatientRecordSignedUrl(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);
      const recordId = p(req.params.recordId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "You do not have access to this patient", "ACCESS_DENIED");

      if (link.accessScope === "SELECTED" && !link.scopeRecordIds.includes(recordId)) {
        throw new AppError(403, "Access to this specific record is not granted", "ACCESS_DENIED");
      }

      const record = await prisma.medicalRecord.findFirst({
        where: { id: recordId, patientId, deletedAt: null },
      });
      if (!record) throw new AppError(404, "Record not found", "NOT_FOUND");

      const signedUrl = await generateSignedUrl(record.fileKey, 900);

      await prisma.auditLog.create({
        data: {
          actorId: req.user!.id,
          actorRole: "DOCTOR",
          action: "VIEW_RECORD",
          resourceType: "MedicalRecord",
          resourceId: recordId,
          ipAddress: req.ip ?? null,
        },
      });

      res.json({ success: true, data: { url: signedUrl, expiresIn: 900 } });
    } catch (err) {
      next(err);
    }
  }

  static async getPatientAISummary(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);
      const recordId = p(req.params.recordId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "Access denied", "ACCESS_DENIED");

      // Verify record belongs to this patient
      const record = await prisma.medicalRecord.findFirst({ where: { id: recordId, patientId } });
      if (!record) throw new AppError(404, "Record not found", "NOT_FOUND");

      const aiResult = await prisma.recordAIResult.findUnique({ where: { recordId } });
      if (!aiResult) throw new AppError(404, "AI summary not yet available", "NOT_FOUND");

      const extractedValues = await prisma.recordExtractedValue.findMany({
        where: { recordId },
        orderBy: { parameterKey: "asc" },
      });

      res.json({ success: true, data: { ...aiResult, extractedValues } });
    } catch (err) {
      next(err);
    }
  }

  // ─── Doctor Notes ────────────────────────────────────────────────────────────

  static async getNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "Access denied", "ACCESS_DENIED");

      const notes = await prisma.doctorNote.findMany({
        where: { doctorId: doctor.id, patientId },
        orderBy: { updatedAt: "desc" },
      });

      res.json({ success: true, data: notes });
    } catch (err) {
      next(err);
    }
  }

  static async createNote(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { doctorId: doctor.id, patientId, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "Access denied", "ACCESS_DENIED");

      const { content, recordId } = createNoteSchema.parse(req.body);

      const note = await prisma.doctorNote.create({
        data: { doctorId: doctor.id, patientId, content, recordId },
      });

      res.status(201).json({ success: true, data: note });
    } catch (err) {
      next(err);
    }
  }

  static async updateNote(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = p(req.params.patientId);
      const noteId = p(req.params.noteId);

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const note = await prisma.doctorNote.findFirst({
        where: { id: noteId, doctorId: doctor.id, patientId },
      });
      if (!note) throw new AppError(404, "Note not found", "NOT_FOUND");

      const { content } = createNoteSchema.parse(req.body);
      const updated = await prisma.doctorNote.update({ where: { id: noteId }, data: { content } });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
}
