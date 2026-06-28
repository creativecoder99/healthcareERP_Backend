import { z } from "zod";

export const adminQuerySchema = z.object({
  page: z.preprocess((val) => Number(val || 1), z.number().min(1).default(1)),
  limit: z.preprocess((val) => Number(val || 10), z.number().min(1).max(100).default(10)),
  search: z.string().optional(),
  plan: z.string().optional(),
  status: z.string().optional(),
});

export const adminCreatePatientSchema = z.object({
  email: z.string().email("Invalid email address"),
  phone: z.string().regex(/^[0-9\s+-]{10,15}$/, "Invalid phone number format"),
  fullName: z.string().min(1, "Full name is required").max(100),
  dob: z.preprocess((val) => val ? new Date(val as string) : null, z.date().nullable().optional()),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
  heightCm: z.preprocess((val) => val ? Number(val) : null, z.number().nullable().optional()),
  weightKg: z.preprocess((val) => val ? Number(val) : null, z.number().nullable().optional()),
  state: z.string().optional().default("Maharashtra"),
});

export const adminUpdatePatientSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().regex(/^[0-9\s+-]{10,15}$/, "Invalid phone number format").optional(),
  fullName: z.string().min(1, "Full name is required").max(100).optional(),
  dob: z.preprocess((val) => val ? new Date(val as string) : null, z.date().nullable().optional()),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
  heightCm: z.preprocess((val) => val ? Number(val) : null, z.number().nullable().optional()),
  weightKg: z.preprocess((val) => val ? Number(val) : null, z.number().nullable().optional()),
  state: z.string().optional(),
});
