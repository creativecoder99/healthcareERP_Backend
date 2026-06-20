import { Router } from "express";
import { authenticate } from "../../shared/middleware/auth.middleware";
import { AnalyticsController } from "./analytics.controller";

const router = Router();
router.use(authenticate);

router.get("/trends", AnalyticsController.trends);
router.get("/health-score", AnalyticsController.healthScore);
router.get("/summary", AnalyticsController.summary);
router.get("/abnormal-history", AnalyticsController.abnormalHistory);

export const analyticsRouter = router;
