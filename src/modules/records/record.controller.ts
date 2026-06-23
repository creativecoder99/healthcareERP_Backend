import { Request, Response, NextFunction } from "express";
import { prisma } from "../../config/prisma";
import { AppError } from "../../shared/middleware/errorHandler";
import { RecordType, ProcessingStatus } from "@prisma/client";
import { uploadFile, generateSignedUrl, deleteFile } from "../../shared/services/cloudinary";
import crypto from "crypto";
import { z } from "zod";
import { addAIProcessingJob } from "../../shared/services/queue";

// MIME whitelist validation
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

// Zod schema for query validations
const listRecordsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(10),
  type: z.nativeEnum(RecordType).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().optional(),
});

export class RecordController {
  /**
   * Helper: Check if storage quota is exceeded
   */
  private static async checkStorageQuota(patientId: string, additionalBytes: number): Promise<boolean> {
    // Phase 2: skeleton always passes on FREE plan
    return true;
  }

  /**
   * Upload record file to S3 and save metadata in database
   */
  static async uploadRecord(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      // Check Patient profile exists
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      if (!req.file) {
        throw new AppError(400, "No file uploaded", "FILE_REQUIRED");
      }

      const file = req.file;

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new AppError(
          400,
          `Invalid file format. Supported formats: PDF, JPEG, PNG, WEBP.`,
          "UNSUPPORTED_MIME_TYPE"
        );
      }

      // Check storage quota
      const withinQuota = await RecordController.checkStorageQuota(patient.id, file.size);
      if (!withinQuota) {
        throw new AppError(400, "Storage quota limit exceeded", "QUOTA_EXCEEDED");
      }

      // Record category type, recordDate, facilityName from form body
      let recordType: RecordType = RecordType.OTHER;
      if (req.body.recordType && Object.values(RecordType).includes(req.body.recordType)) {
        recordType = req.body.recordType as RecordType;
      }

      let recordDate = new Date();
      if (req.body.recordDate) {
        const parsedDate = new Date(req.body.recordDate);
        if (!isNaN(parsedDate.getTime())) {
          recordDate = parsedDate;
        }
      }

      const facilityName = req.body.facilityName || null;

      // Generate unique S3 file key
      const fileId = crypto.randomUUID();
      const cleanFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileKey = `records/${patient.id}/${fileId}-${cleanFileName}`;

      // Upload file to S3
      await uploadFile(fileKey, file.buffer, file.mimetype);

      // Save database entry
      const record = await prisma.medicalRecord.create({
        data: {
          patientId: patient.id,
          uploadedById: req.user.id,
          fileName: file.originalname,
          fileKey,
          fileSize: file.size,
          mimeType: file.mimetype,
          recordType,
          recordDate,
          facilityName,
          processingStatus: ProcessingStatus.PENDING,
        },
      });

      // Trigger asynchronous background processing job (pass buffer so worker skips S3 download)
      await addAIProcessingJob(record.id, file.buffer);

      res.status(201).json({
        success: true,
        message: "Record uploaded successfully",
        data: record,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get list of records (filtered & paginated)
   */
  static async listRecords(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      // Parse parameters
      const { page, limit, type, startDate, endDate, search } = listRecordsQuerySchema.parse(req.query);

      // Pagination setup
      const skip = (page - 1) * limit;

      // Filter conditions
      const whereClause: any = {
        patientId: patient.id,
        deletedAt: null, // Exclude soft deleted records
      };

      if (type) {
        whereClause.recordType = type;
      }

      if (startDate || endDate) {
        whereClause.recordDate = {};
        if (startDate) {
          whereClause.recordDate.gte = new Date(startDate);
        }
        if (endDate) {
          whereClause.recordDate.lte = new Date(endDate);
        }
      }

      if (search) {
        whereClause.OR = [
          { fileName: { contains: search, mode: "insensitive" } },
          { facilityName: { contains: search, mode: "insensitive" } },
        ];
      }

      // DB Query
      const [records, total] = await Promise.all([
        prisma.medicalRecord.findMany({
          where: whereClause,
          orderBy: { recordDate: "desc" },
          skip,
          take: limit,
        }),
        prisma.medicalRecord.count({
          where: whereClause,
        }),
      ]);

      const pages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          records,
          pagination: {
            total,
            page,
            limit,
            pages,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single record detail
   */
  static async getRecordDetail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      const record = await prisma.medicalRecord.findUnique({
        where: { id: req.params.id as string },
      });

      if (!record || record.deletedAt !== null) {
        throw new AppError(404, "Medical record not found", "RECORD_NOT_FOUND");
      }

      // Check ownership
      if (record.patientId !== patient.id) {
        throw new AppError(403, "You do not have access to this record", "FORBIDDEN");
      }

      res.status(200).json({
        success: true,
        data: record,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate S3 signed URL
   */
  static async generateRecordSignedUrl(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      const record = await prisma.medicalRecord.findUnique({
        where: { id: req.params.id as string },
      });

      if (!record || record.deletedAt !== null) {
        throw new AppError(404, "Medical record not found", "RECORD_NOT_FOUND");
      }

      // Check ownership
      if (record.patientId !== patient.id) {
        throw new AppError(403, "You do not have access to this record", "FORBIDDEN");
      }

      // Generate signed URL (expires in 15 minutes)
      const signedUrl = await generateSignedUrl(record.fileKey, 900);

      res.status(200).json({
        success: true,
        data: {
          signedUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Soft delete medical record and delete S3 file
   */
  static async deleteRecord(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      const record = await prisma.medicalRecord.findUnique({
        where: { id: req.params.id as string },
      });

      if (!record || record.deletedAt !== null) {
        throw new AppError(404, "Medical record not found", "RECORD_NOT_FOUND");
      }

      // Check ownership
      if (record.patientId !== patient.id) {
        throw new AppError(403, "You do not have access to this record", "FORBIDDEN");
      }

      // 1. Soft delete in DB
      await prisma.medicalRecord.update({
        where: { id: record.id },
        data: { deletedAt: new Date() },
      });

      // 2. Delete file in S3/MinIO
      await deleteFile(record.fileKey);

      res.status(200).json({
        success: true,
        message: "Record deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get AI summary and extracted values for a medical record
   */
  static async getRecordAISummary(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError(401, "Authentication required", "AUTH_REQUIRED");
      }

      const patient = await prisma.patient.findUnique({
        where: { userId: req.user.id },
      });

      if (!patient) {
        throw new AppError(404, "Patient profile not found", "PROFILE_NOT_FOUND");
      }

      const record = await prisma.medicalRecord.findUnique({
        where: { id: req.params.id as string },
      });

      if (!record || record.deletedAt !== null) {
        throw new AppError(404, "Medical record not found", "RECORD_NOT_FOUND");
      }

      // Check ownership
      if (record.patientId !== patient.id) {
        throw new AppError(403, "You do not have access to this record", "FORBIDDEN");
      }

      // Fetch AI Result and Extracted Biomarkers
      const aiResult = await prisma.recordAIResult.findUnique({
        where: { recordId: record.id },
      });

      const extractedValues = await prisma.recordExtractedValue.findMany({
        where: { recordId: record.id },
        orderBy: { parameterKey: "asc" },
      });

      res.status(200).json({
        success: true,
        data: {
          processingStatus: record.processingStatus,
          aiResult,
          extractedValues,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}
