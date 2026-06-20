import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { z } from "zod";

const updatePatientSchema = z.object({
  fullName: z.string().min(1, "Full name cannot be empty").optional(),
  dateOfBirth: z
    .string()
    .transform((val) => new Date(val))
    .optional(),
  gender: z.string().optional(),
  bloodGroup: z.string().optional(),
  heightCm: z.number().positive("Height must be positive").nullable().optional(),
  weightKg: z.number().positive("Weight must be positive").nullable().optional(),
  allergies: z.array(z.string()).optional(),
  currentMeds: z.any().optional(), // Expected format: { text: string } or [{name, dosage...}]
  emergencyContact: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      relation: z.string().optional(),
    })
    .nullable()
    .optional(),
  insuranceInfo: z
    .object({
      provider: z.string().optional(),
      policyNumber: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export class PatientController {
  /**
   * Fetch current patient's profile details
   */
  static async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      res.status(200).json({
        success: true,
        data: patient,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current patient's profile details
   */
  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      // Check profile existence
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      // Validate inputs
      const validated = updatePatientSchema.parse(req.body);

      // Perform update
      const updatedPatient = await prisma.patient.update({
        where: { id: patient.id },
        data: {
          fullName: validated.fullName,
          dateOfBirth: validated.dateOfBirth,
          gender: validated.gender,
          bloodGroup: validated.bloodGroup,
          heightCm: validated.heightCm,
          weightKg: validated.weightKg,
          allergies: validated.allergies,
          currentMeds: validated.currentMeds,
          emergencyContact: validated.emergencyContact || undefined,
          insuranceInfo: validated.insuranceInfo || undefined,
        },
      });

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: updatedPatient,
      });
    } catch (error) {
      next(error);
    }
  }
}
