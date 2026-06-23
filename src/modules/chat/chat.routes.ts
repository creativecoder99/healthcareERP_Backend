import { Router } from "express";
import { ChatController } from "./chat.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();

// Apply authentication to all chat routes
router.use(authenticate);

// Patient-facing chat session and messaging routes
router.post("/sessions", requireRole(Role.PATIENT), ChatController.createSession);
router.get("/sessions", requireRole(Role.PATIENT), ChatController.listSessions);
router.get("/sessions/:id/messages", requireRole(Role.PATIENT), ChatController.listMessages);
router.post("/sessions/:id/messages", requireRole(Role.PATIENT), ChatController.sendMessageStream);

// Doctor-facing patient AI Brief route
router.get("/doctor/patients/:id/ai-brief", requireRole(Role.DOCTOR), ChatController.getPatientBrief);

export const chatRouter = router;
