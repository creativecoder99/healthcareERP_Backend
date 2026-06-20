import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

const s3Config: any = {
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
};

// If an endpoint is provided (e.g. for local MinIO), use it
if (env.S3_ENDPOINT) {
  s3Config.endpoint = env.S3_ENDPOINT;
  s3Config.forcePathStyle = true; // Required for MinIO/local setup
}

export const s3Client = new S3Client(s3Config);

// S3 is considered enabled only when real credentials are present
const s3Enabled = !!(env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
if (!s3Enabled) {
  logger.warn("⚠️  S3_ACCESS_KEY / S3_SECRET_KEY not set — file storage disabled. AI processing will still work via in-memory buffer.");
}

/**
 * Ensure the documents bucket exists in MinIO/S3
 */
export async function ensureBucketExists(): Promise<void> {
  if (!s3Enabled) return;
  const bucketName = env.S3_BUCKET_DOCUMENTS;
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    logger.info(`🪣 S3 bucket "${bucketName}" exists and is accessible.`);
  } catch (error: any) {
    // If bucket does not exist, create it
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
      try {
        logger.info(`🪣 S3 bucket "${bucketName}" not found. Creating it...`);
        await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
        logger.info(`🪣 S3 bucket "${bucketName}" created successfully.`);
      } catch (createErr: any) {
        logger.error(`❌ Failed to create S3 bucket "${bucketName}":`, createErr);
        throw createErr;
      }
    } else {
      logger.error(`❌ S3 HeadBucket check failed for "${bucketName}":`, error);
      throw error;
    }
  }
}

/**
 * Upload file buffer to S3
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  if (!s3Enabled) {
    logger.warn(`S3 not configured — skipping persistent storage for: ${key}`);
    return;
  }
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET_DOCUMENTS,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    logger.info(`📤 Successfully uploaded file to S3: ${key}`);
  } catch (error) {
    logger.error(`❌ S3 Upload failed for key "${key}":`, error);
    throw error;
  }
}

/**
 * Generate a 15-minute secure signed URL for reading a file
 */
export async function generateSignedUrl(
  key: string,
  expiresInSeconds = 900
): Promise<string> {
  if (!s3Enabled) {
    logger.warn(`S3 not configured — cannot generate signed URL for: ${key}`);
    return "";
  }
  try {
    const command = new GetObjectCommand({
      Bucket: env.S3_BUCKET_DOCUMENTS,
      Key: key,
    });
    const url = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds,
    });
    return url;
  } catch (error) {
    logger.error(`❌ Failed to generate S3 signed URL for key "${key}":`, error);
    throw error;
  }
}

/**
 * Delete a file from S3
 */
export async function deleteFile(key: string): Promise<void> {
  if (!s3Enabled) {
    logger.warn(`S3 not configured — skipping delete for: ${key}`);
    return;
  }
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: env.S3_BUCKET_DOCUMENTS,
        Key: key,
      })
    );
    logger.info(`🗑️ Successfully deleted file from S3: ${key}`);
  } catch (error) {
    logger.error(`❌ S3 Delete failed for key "${key}":`, error);
    throw error;
  }
}
