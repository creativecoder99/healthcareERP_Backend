import { Router } from "express";
import multer from "multer";
import { RecordController } from "./record.controller";
import { authenticate, requireRole } from "../../shared/middleware/auth.middleware";
import { Role } from "@prisma/client";

// Setup multer memory storage with 50MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const router = Router();

// Apply auth middleware to all medical records routes
router.use(authenticate);
router.use(requireRole(Role.PATIENT));

router.post("/upload", upload.single("file"), RecordController.uploadRecord);
router.get("/", RecordController.listRecords);
router.get("/:id", RecordController.getRecordDetail);
router.get("/:id/signed-url", RecordController.generateRecordSignedUrl);
router.get("/:id/ai-summary", RecordController.getRecordAISummary);
router.delete("/:id", RecordController.deleteRecord);

export const recordRouter = router;
