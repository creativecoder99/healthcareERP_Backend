import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import {
  setAvailabilitySchema,
  bookAppointmentSchema,
  updateAppointmentSchema,
  createPrescriptionSchema,
} from "./appointment.schema";
import { AppointmentStatus, Role, LinkStatus } from "@prisma/client";
import { env } from "../../config/env";

const p = (v: string | string[]): string => (Array.isArray(v) ? v[0]! : v);

export class AppointmentController {
  // ─── Doctor Availability Setup ─────────────────────────────────────────────

  static async setAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await prisma.doctor.findUnique({
        where: { userId: req.user!.id },
      });
      if (!doctor) {
        throw new AppError(404, "Doctor profile not found", "DOCTOR_NOT_FOUND");
      }

      const validated = setAvailabilitySchema.parse(req.body);

      // Using transaction to clear existing slots and replace with new ones
      await prisma.$transaction(async (tx) => {
        await tx.availabilitySlot.deleteMany({
          where: { doctorId: doctor.id },
        });

        if (validated.slots.length > 0) {
          await tx.availabilitySlot.createMany({
            data: validated.slots.map((s) => ({
              doctorId: doctor.id,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
              slotMins: s.slotMins,
              isActive: s.isActive,
            })),
          });
        }
      });

      res.status(200).json({
        success: true,
        message: "Availability schedule updated successfully",
      });
    } catch (err) {
      next(err);
    }
  }

  static async getOwnAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const doctor = await prisma.doctor.findUnique({
        where: { userId: req.user!.id },
      });
      if (!doctor) {
        throw new AppError(404, "Doctor profile not found", "DOCTOR_NOT_FOUND");
      }

      const slots = await prisma.availabilitySlot.findMany({
        where: { doctorId: doctor.id },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      });

      res.status(200).json({
        success: true,
        data: slots,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Query Doctor Availability for Booking ─────────────────────────────────

  static async getDoctorAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const doctorId = p(req.params.id);
      const startDateStr = req.query.startDate as string;
      const endDateStr = req.query.endDate as string;

      if (!startDateStr || !endDateStr) {
        throw new AppError(400, "startDate and endDate queries are required", "BAD_REQUEST");
      }

      const doctor = await prisma.doctor.findUnique({
        where: { id: doctorId },
      });
      if (!doctor) {
        throw new AppError(404, "Doctor not found", "DOCTOR_NOT_FOUND");
      }

      // Parse dates (assumed in YYYY-MM-DD format)
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new AppError(400, "Invalid date format. Use YYYY-MM-DD.", "BAD_REQUEST");
      }

      // Fetch availability templates
      const templates = await prisma.availabilitySlot.findMany({
        where: { doctorId, isActive: true },
      });

      // Fetch existing appointments that are active
      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
            ],
          },
          scheduledAt: {
            gte: new Date(startDate.setHours(0, 0, 0, 0)),
            lte: new Date(endDate.setHours(23, 59, 59, 999)),
          },
        },
        select: {
          scheduledAt: true,
          durationMins: true,
        },
      });

      const bookedTimes = appointments.map((a) => a.scheduledAt.getTime());

      // Generate slots per day in range
      const availableSlots: { date: string; slots: string[] }[] = [];
      const current = new Date(startDate);
      current.setHours(0, 0, 0, 0);

      while (current <= endDate) {
        const dayOfWeek = current.getDay(); // 0 = Sun, 1 = Mon ...
        const dayTemplates = templates.filter((t) => t.dayOfWeek === dayOfWeek);
        const daySlots: string[] = [];

        const dateStr = current.toISOString().split("T")[0]!;

        for (const temp of dayTemplates) {
          const [startH, startM] = temp.startTime.split(":").map(Number);
          const [endH, endM] = temp.endTime.split(":").map(Number);

          const slotStart = new Date(current);
          slotStart.setHours(startH!, startM!, 0, 0);

          const slotEnd = new Date(current);
          slotEnd.setHours(endH!, endM!, 0, 0);

          let runTime = new Date(slotStart);
          while (runTime < slotEnd) {
            // Check if slot overlaps with booked appointments
            const runTimeMs = runTime.getTime();
            const isBooked = bookedTimes.some((bt) => bt === runTimeMs);

            // Don't show slots in the past
            const isFuture = runTimeMs > Date.now();

            if (!isBooked && isFuture) {
              daySlots.push(runTime.toISOString());
            }

            runTime = new Date(runTime.getTime() + temp.slotMins * 60 * 1000);
          }
        }

        availableSlots.push({
          date: dateStr,
          slots: daySlots.sort(),
        });

        current.setDate(current.getDate() + 1);
      }

      res.status(200).json({
        success: true,
        data: availableSlots,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Booking Appointments ──────────────────────────────────────────────────

  static async bookAppointment(req: Request, res: Response, next: NextFunction) {
    try {
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.id },
      });
      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");
      }

      const { doctorId, scheduledAt, type, notes } = bookAppointmentSchema.parse(req.body);

      // Verify patient-doctor link is approved
      const link = await prisma.patientDoctorLink.findFirst({
        where: {
          patientId: patient.id,
          doctorId,
          status: LinkStatus.APPROVED,
        },
      });

      if (!link) {
        throw new AppError(403, "You can only book appointments with approved linked doctors", "LINK_REQUIRED");
      }

      const scheduledDate = new Date(scheduledAt);
      if (scheduledDate.getTime() <= Date.now()) {
        throw new AppError(400, "Cannot book appointments in the past", "BAD_REQUEST");
      }

      // Check slot availability (verify weekly slots support this time)
      const dayOfWeek = scheduledDate.getDay();
      const startTimeStr = scheduledDate.toTimeString().slice(0, 5); // "HH:MM"

      const matchedTemplate = await prisma.availabilitySlot.findFirst({
        where: {
          doctorId,
          dayOfWeek,
          startTime: { lte: startTimeStr },
          endTime: { gt: startTimeStr },
          isActive: true,
        },
      });

      if (!matchedTemplate) {
        throw new AppError(400, "Doctor is not available at the requested time", "DOCTOR_UNAVAILABLE");
      }

      // Check double-booking
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          doctorId,
          scheduledAt: scheduledDate,
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
            ],
          },
        },
      });

      if (existingAppointment) {
        throw new AppError(409, "This slot has already been booked by another patient", "SLOT_TAKEN");
      }

      // Check if patient already has an appointment at this time
      const patientAppointment = await prisma.appointment.findFirst({
        where: {
          patientId: patient.id,
          scheduledAt: scheduledDate,
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
            ],
          },
        },
      });

      if (patientAppointment) {
        throw new AppError(409, "You already have another booking at this time", "PATIENT_DOUBLE_BOOKING");
      }

      // Book
      const appointment = await prisma.appointment.create({
        data: {
          patientId: patient.id,
          doctorId,
          scheduledAt: scheduledDate,
          type,
          notes,
          durationMins: matchedTemplate.slotMins,
          videoSession: type === "VIDEO" ? {
            create: {
              status: "WAITING",
            },
          } : undefined,
        },
        include: {
          videoSession: true,
        },
      });

      // Create notification for Doctor
      const doctorProfile = await prisma.doctor.findUnique({
        where: { id: doctorId },
        include: { user: true },
      });

      if (doctorProfile) {
        await prisma.notification.create({
          data: {
            userId: doctorProfile.userId,
            type: "SYSTEM",
            title: "New Appointment Booked",
            body: `${patient.fullName} has booked a video consultation on ${scheduledDate.toLocaleString("en-IN")}.`,
            data: { appointmentId: appointment.id },
          },
        });
      }

      res.status(201).json({
        success: true,
        message: "Appointment booked successfully",
        data: appointment,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Fetch User Appointments ───────────────────────────────────────────────

  static async getAppointments(req: Request, res: Response, next: NextFunction) {
    try {
      const isDoctor = req.user!.role === Role.DOCTOR;
      let appointments;

      if (isDoctor) {
        const doctor = await prisma.doctor.findUnique({
          where: { userId: req.user!.id },
        });
        if (!doctor) throw new AppError(404, "Doctor profile not found", "DOCTOR_NOT_FOUND");

        appointments = await prisma.appointment.findMany({
          where: { doctorId: doctor.id },
          include: {
            patient: {
              select: { id: true, fullName: true, avatarUrl: true, bloodGroup: true },
            },
            videoSession: true,
          },
          orderBy: { scheduledAt: "asc" },
        });
      } else {
        const patient = await prisma.patient.findUnique({
          where: { userId: req.user!.id },
        });
        if (!patient) throw new AppError(404, "Patient profile not found", "PATIENT_NOT_FOUND");

        appointments = await prisma.appointment.findMany({
          where: { patientId: patient.id },
          include: {
            doctor: {
              select: { id: true, fullName: true, specialisation: true, avatarUrl: true },
            },
            videoSession: true,
            prescriptions: true,
          },
          orderBy: { scheduledAt: "asc" },
        });
      }

      res.status(200).json({
        success: true,
        data: appointments,
      });
    } catch (err) {
      next(err);
    }
  }

  static async getAppointmentDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const appointmentId = p(req.params.id);

      const appointment = await prisma.appointment.findFirst({
        where: {
          OR: [
            { id: appointmentId },
            { videoSession: { roomId: appointmentId } },
          ],
        },
        include: {
          patient: { include: { user: { select: { email: true } } } },
          doctor: { include: { user: { select: { email: true } } } },
          videoSession: true,
          prescriptions: true,
        },
      });

      if (!appointment) {
        throw new AppError(404, "Appointment not found", "NOT_FOUND");
      }

      // Authorization check
      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });

      const isPatientOwner = patient && appointment.patientId === patient.id;
      const isDoctorOwner = doctor && appointment.doctorId === doctor.id;

      if (!isPatientOwner && !isDoctorOwner) {
        throw new AppError(403, "You do not have access to this appointment details", "FORBIDDEN");
      }

      res.status(200).json({
        success: true,
        data: appointment,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Manage Appointment Status ─────────────────────────────────────────────

  static async updateAppointment(req: Request, res: Response, next: NextFunction) {
    try {
      const appointmentId = p(req.params.id);
      const validated = updateAppointmentSchema.parse(req.body);

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { videoSession: true },
      });

      if (!appointment) {
        throw new AppError(404, "Appointment not found", "NOT_FOUND");
      }

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });

      const isPatientOwner = patient && appointment.patientId === patient.id;
      const isDoctorOwner = doctor && appointment.doctorId === doctor.id;

      if (!isPatientOwner && !isDoctorOwner) {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }

      // Check state machine constraints
      if (validated.status) {
        if (validated.status === AppointmentStatus.CANCELLED) {
          if (!validated.cancelReason) {
            throw new AppError(400, "cancellation reason is required", "BAD_REQUEST");
          }
        }

        // Doctor only can confirm or complete
        if (validated.status === AppointmentStatus.CONFIRMED && !isDoctorOwner) {
          throw new AppError(403, "Only doctors can confirm appointments", "FORBIDDEN");
        }
        if (validated.status === AppointmentStatus.COMPLETED && !isDoctorOwner) {
          throw new AppError(403, "Only doctors can complete appointments", "FORBIDDEN");
        }
      }

      const updateData: any = { ...validated };

      // Update session status if call completed
      const updated = await prisma.$transaction(async (tx) => {
        const appt = await tx.appointment.update({
          where: { id: appointmentId },
          data: updateData,
        });

        if (validated.status === AppointmentStatus.CANCELLED && appointment.videoSession) {
          await tx.videoSession.update({
            where: { appointmentId },
            data: { status: "ENDED", endedAt: new Date() },
          });
        }

        if (validated.status === AppointmentStatus.COMPLETED && appointment.videoSession) {
          await tx.videoSession.update({
            where: { appointmentId },
            data: { status: "ENDED", endedAt: new Date() },
          });
        }

        return appt;
      });

      // Notify the other party of cancellation or status update
      const notifyUserId = isPatientOwner
        ? (await prisma.doctor.findUnique({ where: { id: appointment.doctorId } }))?.userId
        : (await prisma.patient.findUnique({ where: { id: appointment.patientId } }))?.userId;

      if (notifyUserId) {
        await prisma.notification.create({
          data: {
            userId: notifyUserId,
            type: "SYSTEM",
            title: `Appointment Update`,
            body: `Your appointment status has been updated to ${validated.status || "updated"}.`,
            data: { appointmentId },
          },
        });
      }

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── WebRTC Video Token & ICE Server Config ───────────────────────────────

  static async getCallToken(req: Request, res: Response, next: NextFunction) {
    try {
      const appointmentId = p(req.params.id);

      const appointment = await prisma.appointment.findFirst({
        where: {
          OR: [
            { id: appointmentId },
            { videoSession: { roomId: appointmentId } },
          ],
        },
        include: { videoSession: true },
      });

      if (!appointment || !appointment.videoSession) {
        throw new AppError(404, "Video session not found for this appointment", "NOT_FOUND");
      }

      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new AppError(400, "Appointment has been cancelled", "BAD_REQUEST");
      }

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      const patient = await prisma.patient.findUnique({ where: { userId: req.user!.id } });

      const isPatientOwner = patient && appointment.patientId === patient.id;
      const isDoctorOwner = doctor && appointment.doctorId === doctor.id;

      if (!isPatientOwner && !isDoctorOwner) {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }

      // Generate ICE server list based on TURN config
      let iceServers: any[] = [{ urls: "stun:stun.l.google.com:19302" }];

      if (env.TURN_SERVER_URL && env.COTURN_SHARED_SECRET) {
        const unixTimestamp = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 hours expiry
        const username = `${unixTimestamp}:${req.user!.id}`;
        const hmac = crypto.createHmac("sha1", env.COTURN_SHARED_SECRET);
        hmac.update(username);
        const credential = hmac.digest("base64");

        iceServers.push({
          urls: env.TURN_SERVER_URL,
          username: username,
          credential: credential,
        });
      }

      res.status(200).json({
        success: true,
        data: {
          roomId: appointment.videoSession.roomId,
          iceServers,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  // ─── Post-Call prescription ────────────────────────────────────────────────

  static async createPrescription(req: Request, res: Response, next: NextFunction) {
    try {
      const appointmentId = p(req.params.id);

      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { videoSession: true },
      });

      if (!appointment) {
        throw new AppError(404, "Appointment not found", "NOT_FOUND");
      }

      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor || appointment.doctorId !== doctor.id) {
        throw new AppError(403, "Only the assigned doctor can issue prescriptions", "FORBIDDEN");
      }

      const { medicines, notes } = createPrescriptionSchema.parse(req.body);

      const prescription = await prisma.prescription.create({
        data: {
          patientId: appointment.patientId,
          doctorId: doctor.id,
          appointmentId: appointment.id,
          medicines: medicines as any,
          notes,
        },
      });

      // Update appointment status to COMPLETED if not already done
      if (appointment.status !== AppointmentStatus.COMPLETED) {
        await prisma.$transaction(async (tx) => {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: { status: AppointmentStatus.COMPLETED },
          });

          if (appointment.videoSession) {
            await tx.videoSession.update({
              where: { appointmentId },
              data: { status: "ENDED", endedAt: new Date() },
            });
          }
        });
      }

      // Notify patient
      const patientProfile = await prisma.patient.findUnique({
        where: { id: appointment.patientId },
      });
      if (patientProfile) {
        await prisma.notification.create({
          data: {
            userId: patientProfile.userId,
            type: "NEW_PRESCRIPTION",
            title: "New Prescription Uploaded",
            body: `Dr. ${doctor.fullName} has uploaded a digital prescription.`,
            data: { prescriptionId: prescription.id },
          },
        });
      }

      res.status(201).json({
        success: true,
        message: "Prescription uploaded successfully",
        data: prescription,
      });
    } catch (err) {
      next(err);
    }
  }
}
