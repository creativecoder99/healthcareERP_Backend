import { Router } from "express";
import { LinkingController } from "./linking.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

const router = Router();
router.use(authenticate);

// ─── Shared: list all links for the current user (patient or doctor) ─────────
router.get("/", LinkingController.getLinks);

// ─── Patient-only: approve / deny / revoke ───────────────────────────────────
router.post("/:id/approve", requireRole(Role.PATIENT), LinkingController.approveLink);
router.post("/:id/deny", requireRole(Role.PATIENT), LinkingController.denyLink);

// ─── Both roles: revoke ───────────────────────────────────────────────────────
router.delete("/:id", requireRole(Role.PATIENT, Role.DOCTOR), LinkingController.revokeLink);

export const linksRouter = router;
