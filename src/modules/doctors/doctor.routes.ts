import { Router } from "express";
import { DoctorController } from "./doctor.controller";
import { LinkingController } from "../linking/linking.controller";
import { AnalyticsController } from "../analytics/analytics.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();

router.use(authenticate);
router.use(requireRole(Role.DOCTOR));

// ─── Profile ────────────────────────────────────────────────────────────────
router.get("/profile", DoctorController.getProfile);
router.put("/profile", DoctorController.updateProfile);

// ─── Linking: doctor requests access to a patient ────────────────────────────
router.post("/patients/request-access", LinkingController.requestAccess);

// ─── Linked patients ─────────────────────────────────────────────────────────
router.get("/patients", DoctorController.getLinkedPatients);
router.get("/patients/:patientId", DoctorController.getPatientDetail);
router.get("/patients/:patientId/records", DoctorController.getPatientRecords);
router.get("/patients/:patientId/records/:recordId/signed-url", DoctorController.getPatientRecordSignedUrl);
router.get("/patients/:patientId/records/:recordId/ai-summary", DoctorController.getPatientAISummary);

// ─── Doctor notes ────────────────────────────────────────────────────────────
router.get("/patients/:patientId/notes", DoctorController.getNotes);
router.post("/patients/:patientId/notes", DoctorController.createNote);
router.put("/patients/:patientId/notes/:noteId", DoctorController.updateNote);

// ─── Patient analytics (doctor-scoped) ───────────────────────────────────────
router.get("/patients/:patientId/analytics", AnalyticsController.doctorPatientTrends);

export const doctorRouter = router;
