import { v2 as cloudinary } from "cloudinary";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

// Configure Cloudinary SDK
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

logger.info("☁️ Cloudinary SDK configured and initialized.");

/**
 * Upload file buffer to Cloudinary as an authenticated raw resource
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Note: Cloudinary treats PDFs and other non-images as 'raw' resources
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        public_id: key,
        resource_type: "raw",
        type: "authenticated", // Ensures file is not public
      },
      (error, result) => {
        if (error) {
          logger.error(`❌ Cloudinary upload failed for public_id "${key}":`, error);
          reject(error);
        } else {
          logger.info(`📤 Successfully uploaded file to Cloudinary: ${key}`);
          resolve();
        }
      }
    );
    uploadStream.end(buffer);
  });
}

/**
 * Generate a secure signed URL for viewing/downloading a raw authenticated file
 */
export async function generateSignedUrl(
  key: string,
  expiresInSeconds = 900
): Promise<string> {
  try {
    // Generate unix timestamp for expiration
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    
    // Cloudinary API utility for private/authenticated downloads
    const url = cloudinary.utils.private_download_url(key, "raw", {
      resource_type: "raw",
      type: "authenticated",
      expires_at: expiresAt,
    });
    
    return url;
  } catch (error) {
    logger.error(`❌ Failed to generate Cloudinary signed URL for key "${key}":`, error);
    throw error;
  }
}

/**
 * Delete a raw authenticated file from Cloudinary
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    const result = await cloudinary.uploader.destroy(key, {
      resource_type: "raw",
      type: "authenticated",
    });
    
    if (result.result !== "ok" && result.result !== "not_found") {
      logger.warn(`⚠️ Cloudinary delete response for "${key}":`, result);
    } else {
      logger.info(`🗑️ Successfully deleted file from Cloudinary: ${key}`);
    }
  } catch (error) {
    logger.error(`❌ Cloudinary Delete failed for key "${key}":`, error);
    throw error;
  }
}
