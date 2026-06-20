import { Worker, Job } from "bullmq";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../config/prisma";
import { redis } from "../shared/services/redis";
import { s3Client } from "../shared/services/s3";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { analyzeMedicalDocument, generateEmbedding } from "../shared/services/gemini";
import { emitToUser } from "../shared/services/socket";
import { ProcessingStatus } from "@prisma/client";
import crypto from "crypto";

const QUEUE_NAME = "ai-processing";

logger.info(`⚙️ Starting BullMQ AI processing worker process...`);

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const { recordId } = job.data;
    logger.info(`🚀 Starting processing for job ${job.id} (Record ID: ${recordId})`);

    // 1. Fetch MedicalRecord metadata
    const record = await prisma.medicalRecord.findUnique({
      where: { id: recordId },
      include: { patient: true },
    });

    if (!record || record.deletedAt !== null) {
      logger.warn(`⚠️ Medical record ${recordId} not found or soft-deleted. Skipping job.`);
      return;
    }

    // 2. Update status to PROCESSING
    await prisma.medicalRecord.update({
      where: { id: recordId },
      data: { processingStatus: ProcessingStatus.PROCESSING },
    });
    emitToUser(record.patient.userId, "record:processed", {
      recordId: record.id,
      status: ProcessingStatus.PROCESSING,
    });

    try {
      // 3. Get file buffer — from job data (preferred) or fall back to S3 download
      let fileBuffer: Buffer;
      if (job.data.fileBase64) {
        fileBuffer = Buffer.from(job.data.fileBase64, "base64");
        logger.info(`📦 Using in-memory file buffer (${fileBuffer.length} bytes)`);
      } else {
        logger.info(`📥 Downloading file for record ${recordId} from S3...`);
        const s3Response = await s3Client.send(new GetObjectCommand({
          Bucket: env.S3_BUCKET_DOCUMENTS,
          Key: record.fileKey,
        }));
        if (!s3Response.Body) throw new Error("S3 object body is empty");
        const chunks: Buffer[] = [];
        for await (const chunk of s3Response.Body as any) {
          chunks.push(Buffer.from(chunk));
        }
        fileBuffer = Buffer.concat(chunks);
        logger.info(`📥 Downloaded file buffer (${fileBuffer.length} bytes)`);
      }

      // 4. Call Gemini service for multimodal analysis (OCR + extraction + summaries)
      logger.info(`🧠 Calling Gemini 1.5 Flash analyzer...`);
      const analysis = await analyzeMedicalDocument(fileBuffer, record.mimeType, record.fileName);

      // 5. Atomic database transactional insert/upsert of AI results & extracted values
      logger.info(`💾 Saving extracted biomarkers and summaries to database...`);
      await prisma.$transaction(async (tx) => {
        // Create or update RecordAIResult
        await tx.recordAIResult.upsert({
          where: { recordId: record.id },
          create: {
            recordId: record.id,
            summaryText: analysis.summaryText,
            clinicalSummary: analysis.clinicalSummary || null,
            extractedRaw: JSON.stringify(analysis.extractedValues),
            confidence: analysis.confidence,
            flaggedValues: JSON.stringify(analysis.extractedValues.filter((v) => v.isAbnormal)),
            modelVersion: env.GEMINI_API_KEY ? "gemini-1.5-flash" : "mock-dev-engine",
          },
          update: {
            summaryText: analysis.summaryText,
            clinicalSummary: analysis.clinicalSummary || null,
            extractedRaw: JSON.stringify(analysis.extractedValues),
            confidence: analysis.confidence,
            flaggedValues: JSON.stringify(analysis.extractedValues.filter((v) => v.isAbnormal)),
            modelVersion: env.GEMINI_API_KEY ? "gemini-1.5-flash" : "mock-dev-engine",
          },
        });

        // Delete any existing extracted values for this record first to prevent duplicates on retry
        await tx.recordExtractedValue.deleteMany({
          where: { recordId: record.id },
        });

        // Create new extracted values
        if (analysis.extractedValues && analysis.extractedValues.length > 0) {
          const extractedValuesData = analysis.extractedValues.map((val) => ({
            recordId: record.id,
            parameterKey: val.parameterKey,
            parameterLabel: val.parameterLabel,
            value: val.value,
            unit: val.unit,
            referenceMin: val.referenceMin ?? null,
            referenceMax: val.referenceMax ?? null,
            isAbnormal: val.isAbnormal,
            severity: val.severity || null,
            recordDate: record.recordDate || new Date(),
          }));

          await tx.recordExtractedValue.createMany({
            data: extractedValuesData,
          });
        }
      });

      // 6. Generate chunks and vector embeddings (for Phase 6 RAG Chatbot support)
      logger.info(`🧬 Chunking report content and generating vector embeddings...`);
      
      // We partition the record into logical text chunks:
      const chunksToEmbed: string[] = [];

      // Chunk 1: Overview Summary Chunk
      const overviewText = `Medical Report Summary.
File Name: ${record.fileName}
Record Type: ${record.recordType}
Facility: ${record.facilityName || "Unknown"}
Date: ${record.recordDate ? new Date(record.recordDate).toLocaleDateString() : "Unknown"}
Patient Summary: ${analysis.summaryText}
${analysis.clinicalSummary ? `Clinical Brief: ${analysis.clinicalSummary}` : ""}`;
      chunksToEmbed.push(overviewText);

      // Chunk 2: Biomarkers Details Chunk
      if (analysis.extractedValues && analysis.extractedValues.length > 0) {
        const biomarkersText = `Report Biomarkers Details.
File: ${record.fileName}
${analysis.extractedValues
  .map(
    (v) =>
      `- ${v.parameterLabel} (${v.parameterKey}): ${v.value} ${v.unit}. Reference Range: ${
        v.referenceMin !== undefined ? v.referenceMin : "N/A"
      } - ${v.referenceMax !== undefined ? v.referenceMax : "N/A"}. Status: ${
        v.isAbnormal ? `Abnormal (${v.severity || "MILD"})` : "Normal"
      }`
  )
  .join("\n")}`;
        chunksToEmbed.push(biomarkersText);
      }

      // Generate embeddings and save via raw SQL (since Prisma doesn't natively support pgvector vector inserts)
      for (const chunkText of chunksToEmbed) {
        const embedding = await generateEmbedding(chunkText);
        const chunkId = crypto.randomUUID();
        const embeddingSql = `[${embedding.join(",")}]`;

        await prisma.$executeRawUnsafe(
          `INSERT INTO "RecordVectorChunk" (id, "recordId", "patientId", content, metadata, embedding) 
           VALUES ($1, $2, $3, $4, $5, $6::vector)`,
          chunkId,
          record.id,
          record.patientId,
          chunkText,
          JSON.stringify({ fileName: record.fileName, recordDate: record.recordDate }),
          embeddingSql
        );
      }

      // 7. Update status to COMPLETED
      await prisma.medicalRecord.update({
        where: { id: recordId },
        data: { processingStatus: ProcessingStatus.COMPLETED },
      });

      emitToUser(record.patient.userId, "record:processed", {
        recordId: record.id,
        status: ProcessingStatus.COMPLETED,
      });

      logger.info(`✨ Successfully processed job ${job.id} for record: ${recordId}`);
    } catch (processError: any) {
      logger.error(`❌ Processing execution failed for job ${job.id}: ${processError.message}`);
      
      // Update DB status to FAILED
      await prisma.medicalRecord.update({
        where: { id: recordId },
        data: { processingStatus: ProcessingStatus.FAILED },
      });

      emitToUser(record.patient.userId, "record:processed", {
        recordId: record.id,
        status: ProcessingStatus.FAILED,
      });

      throw processError; // Rethrow to let BullMQ handle retries
    }
  },
  {
    connection: redis as any,
    concurrency: 2, // process up to 2 jobs concurrently
  }
);

worker.on("ready", () => {
  logger.info("📡 BullMQ AI worker is ready and listening for jobs");
});

worker.on("failed", (job, err) => {
  logger.error(`❌ Job ${job?.id} failed permanently: ${err.message}`);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down worker gracefully...");
  await worker.close();
  logger.info("Worker shut down complete");
  process.exit(0);
});
