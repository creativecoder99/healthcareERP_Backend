import { Router } from "express";
import { AdminController } from "./admin.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

export const adminRouter = Router();

// Protect all routes under /admin with admin-only auth middleware
adminRouter.use(authenticate, requireRole(Role.PLATFORM_ADMIN));

adminRouter.get("/analytics", AdminController.getAnalytics);

adminRouter.get("/patients", AdminController.getPatients);
adminRouter.post("/patients", AdminController.createPatient);
adminRouter.put("/patients/:id", AdminController.updatePatient);
adminRouter.delete("/patients/:id", AdminController.deletePatient);

adminRouter.post("/users/:id/suspend", AdminController.toggleSuspendUser);

adminRouter.get("/payments", AdminController.getPayments);
adminRouter.post("/payments/:id/refund", AdminController.processRefund);
