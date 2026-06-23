import { Router } from "express";
import { AppointmentController } from "./appointment.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();

// Apply authentication to all appointment routes
router.use(authenticate);

// Doctor availability settings routes
router.post(
  "/doctor/availability",
  requireRole(Role.DOCTOR),
  AppointmentController.setAvailability
);
router.get(
  "/doctor/availability",
  requireRole(Role.DOCTOR),
  AppointmentController.getOwnAvailability
);

// Patient queries doctor availability slot list
router.get(
  "/doctor/:id/availability",
  requireRole(Role.PATIENT),
  AppointmentController.getDoctorAvailability
);

// Booking, listing and detail routes
router.post(
  "/",
  requireRole(Role.PATIENT),
  AppointmentController.bookAppointment
);
router.get(
  "/",
  requireRole(Role.PATIENT, Role.DOCTOR),
  AppointmentController.getAppointments
);
router.get(
  "/:id",
  requireRole(Role.PATIENT, Role.DOCTOR),
  AppointmentController.getAppointmentDetail
);
router.patch(
  "/:id",
  requireRole(Role.PATIENT, Role.DOCTOR),
  AppointmentController.updateAppointment
);

// Video call signaling details (token + turn config)
router.get(
  "/:id/video-token",
  requireRole(Role.PATIENT, Role.DOCTOR),
  AppointmentController.getCallToken
);

// Doctor uploads post-call prescription
router.post(
  "/:id/prescription",
  requireRole(Role.DOCTOR),
  AppointmentController.createPrescription
);

export const appointmentRouter = router;
