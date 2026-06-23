import { z } from "zod";
import { AppointmentStatus, AppointmentType } from "@prisma/client";

export const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Start time must be in HH:MM format"),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "End time must be in HH:MM format"),
  slotMins: z.number().int().positive().default(30),
  isActive: z.boolean().default(true),
});

export const setAvailabilitySchema = z.object({
  slots: z.array(slotSchema),
});

export const bookAppointmentSchema = z.object({
  doctorId: z.string().min(1, "Doctor ID is required"),
  scheduledAt: z.string().datetime("Invalid date format, must be ISO-8601"),
  type: z.nativeEnum(AppointmentType).default(AppointmentType.VIDEO),
  notes: z.string().max(500).optional(),
});

export const updateAppointmentSchema = z.object({
  status: z.nativeEnum(AppointmentStatus).optional(),
  cancelReason: z.string().max(300).optional(),
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export const prescriptionMedicineSchema = z.object({
  name: z.string().min(1, "Medicine name is required"),
  dosage: z.string().min(1, "Dosage is required"),
  frequency: z.string().min(1, "Frequency is required"),
  duration: z.string().min(1, "Duration is required"),
  notes: z.string().optional(),
});

export const createPrescriptionSchema = z.object({
  medicines: z.array(prescriptionMedicineSchema).min(1, "At least one medicine is required"),
  notes: z.string().max(1000).optional(),
});
