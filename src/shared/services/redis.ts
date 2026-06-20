import Redis from "ioredis";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null, // Needed for BullMQ compatibility
});

redis.on("connect", () => {
  logger.info("🔑 Connected to Redis successfully");
});

redis.on("error", (err) => {
  logger.error("❌ Redis connection error:", err);
});
