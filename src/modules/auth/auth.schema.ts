import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const phoneSchema = z
  .string()
  .regex(/^[0-9\s+-]{10,15}$/, "Invalid phone number format");

export const registerPatientSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(100),
  email: z.string().email("Invalid email address"),
  phone: phoneSchema,
  password: passwordSchema,
  dob: z.preprocess((val) => {
    if (typeof val === "string" || val instanceof Date) return new Date(val);
    return val;
  }, z.date({ message: "Invalid date of birth" })),
  gender: z.enum(["male", "female", "non-binary", "prefer-not"], {
    message: "Please select a valid gender",
  }),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"], {
    message: "Please select a valid blood group",
  }),
  height: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return undefined;
    return Number(val);
  }, z.number().min(50).max(300).optional()),
  weight: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return undefined;
    return Number(val);
  }, z.number().min(1).max(300).optional()),
  allergies: z.string().optional(),
  medications: z.string().optional(),
  emergencyName: z.string().min(1, "Emergency contact name is required"),
  emergencyPhone: phoneSchema,
  emergencyRelation: z.enum(["spouse", "parent", "child", "sibling", "friend", "other"], {
    message: "Please select a valid relationship",
  }),
  insuranceProvider: z.string().optional(),
  policyNumber: z.string().optional(),
  terms: z.boolean().refine((val) => val === true, "You must accept the terms"),
});

export const registerDoctorSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(100),
  email: z.string().email("Invalid email address"),
  phone: phoneSchema,
  password: passwordSchema,
  specialisation: z.string().min(1, "Specialisation is required"),
  licenseNumber: z.string().min(1, "Registration/Licence number is required"),
  experience: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return undefined;
    return Number(val);
  }, z.number().min(0).max(60).optional()),
  consultationFee: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return undefined;
    return Number(val);
  }, z.number().min(0).optional()),
  affiliation: z.string().optional(),
  terms: z.boolean().refine((val) => val === true, "You must accept the terms"),
});

export const requestOtpSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  phone: phoneSchema.optional(),
}).refine((data) => data.email || data.phone, {
  message: "Either email or phone is required",
  path: ["email"],
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").optional(),
  phone: phoneSchema.optional(),
  password: z.string().optional(),
  otp: z.string().length(6, "OTP must be exactly 6 digits").optional(),
}).refine((data) => {
  // Can login with:
  // 1. email + password
  // 2. email + otp
  // 3. phone + otp
  if (data.email && data.password) return true;
  if (data.email && data.otp) return true;
  if (data.phone && data.otp) return true;
  return false;
}, {
  message: "Invalid login credentials. Provide email/password, email/OTP, or phone/OTP.",
  path: ["password"],
});

export const requestRegisterOtpSchema = z.object({
  type: z.enum(["email", "phone"]),
  value: z.string().min(1, "Value is required"),
});

export const verifyRegisterOtpSchema = z.object({
  type: z.enum(["email", "phone"]),
  value: z.string().min(1, "Value is required"),
  otp: z.string().length(6, "OTP must be exactly 6 digits"),
});
