import { z } from "zod";

export const updateDoctorSchema = z.object({
  fullName: z.string().min(1, "Full name cannot be empty").max(100).optional(),
  specialisation: z.string().min(1).optional(),
  consultationFee: z.number().nonnegative().optional(),
  bio: z.string().max(600).optional(),
});

export const createNoteSchema = z.object({
  content: z.string().min(1, "Note content cannot be empty"),
  recordId: z.string().optional(),
});
