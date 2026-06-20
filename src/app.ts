import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler } from "./shared/middleware/errorHandler";

const app = express();

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet());
const allowedOrigins = [env.FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
app.use(
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
import { authRouter } from "./modules/auth/auth.routes";
import { patientRouter } from "./modules/patients/patient.routes";
import { recordRouter } from "./modules/records/record.routes";
import { doctorRouter } from "./modules/doctors/doctor.routes";
import { linksRouter } from "./modules/linking/linking.routes";
import { paymentRouter } from "./modules/payments/payment.routes";
import { webhookRouter } from "./modules/webhooks/webhook.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { ensureBucketExists } from "./shared/services/s3";

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/patient", patientRouter);     // patient profile + invite doctor
app.use("/api/v1/records", recordRouter);      // patient record uploads
app.use("/api/v1/doctor", doctorRouter);       // doctor profile + patient access
app.use("/api/v1/links", linksRouter);         // approve / deny / revoke links
app.use("/api/v1/payments", paymentRouter);    // subscription, orders, verify
app.use("/api/v1/webhooks", webhookRouter);    // Razorpay webhook (no auth)
app.use("/api/v1/analytics", analyticsRouter); // analytics & trends

// Ensure S3 bucket is created on startup
ensureBucketExists().catch((err) => {
  logger.error("Failed to verify S3 bucket availability:", err);
});

// ─── Error Handler (must be last) ────────────────────────────────────────────
app.use(errorHandler);

import { createServer } from "http";
import { initSocketServer } from "./shared/services/socket";

const httpServer = createServer(app);
initSocketServer(httpServer);

// ─── AI Worker (runs in-process for single-service deployment) ───────────────
import("./workers/ai-worker")
  .then(() => logger.info("⚙️  AI processing worker started in-process"))
  .catch((err) => logger.error("Failed to start AI worker:", err));

// ─── Start ────────────────────────────────────────────────────────────────────
if (env.NODE_ENV !== "test") {
  const server = httpServer.listen(env.PORT, () => {
    logger.info(`🏥 MediCore API running on http://localhost:${env.PORT}`);
    logger.info(`📋 Environment: ${env.NODE_ENV}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully...");
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  });
}

export { app, httpServer };
