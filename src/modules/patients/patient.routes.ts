import { Router } from "express";
import { PatientController } from "./patient.controller";
import { LinkingController } from "../linking/linking.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();

router.use(authenticate);
router.use(requireRole(Role.PATIENT));

router.get("/profile", PatientController.getProfile);
router.put("/profile", PatientController.updateProfile);

// Patient invites a doctor (POST /api/v1/patient/doctors/invite)
router.post("/doctors/invite", LinkingController.inviteDoctor);

export const patientRouter = router;
