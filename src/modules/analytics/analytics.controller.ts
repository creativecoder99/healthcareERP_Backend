import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { getTrends, getHealthScore, getSummary, getAbnormalHistory } from "./analytics.service";

async function resolvePatientId(userId: string): Promise<string> {
  const patient = await prisma.patient.findUnique({ where: { userId } });
  if (!patient) throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
  return patient.id;
}

export class AnalyticsController {
  static async trends(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = await resolvePatientId(req.user!.id);
      const { parameter, from, to } = req.query as Record<string, string>;
      const data = await getTrends(patientId, parameter, from, to);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  static async healthScore(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = await resolvePatientId(req.user!.id);
      const data = await getHealthScore(patientId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  static async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = await resolvePatientId(req.user!.id);
      const data = await getSummary(patientId);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  static async abnormalHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const patientId = await resolvePatientId(req.user!.id);
      const { from, to } = req.query as Record<string, string>;
      const data = await getAbnormalHistory(patientId, from, to);
      res.json({ success: true, data });
    } catch (err) { next(err); }
  }

  // Doctor-scoped: verifies the requesting doctor is linked to the patient
  static async doctorPatientTrends(req: Request, res: Response, next: NextFunction) {
    try {
      const { patientId } = req.params;
      const doctor = await prisma.doctor.findUnique({ where: { userId: req.user!.id } });
      if (!doctor) throw new AppError(404, "Doctor profile not found", "PROFILE_NOT_FOUND");

      const link = await prisma.patientDoctorLink.findFirst({
        where: { patientId, doctorId: doctor.id, status: "APPROVED" },
      });
      if (!link) throw new AppError(403, "You do not have access to this patient", "FORBIDDEN");

      const { parameter, from, to } = req.query as Record<string, string>;
      const [trends, healthScore, summary, abnormal] = await Promise.all([
        getTrends(patientId, parameter, from, to),
        getHealthScore(patientId),
        getSummary(patientId),
        getAbnormalHistory(patientId, from, to),
      ]);

      res.json({ success: true, data: { trends, healthScore, summary, abnormal } });
    } catch (err) { next(err); }
  }
}
