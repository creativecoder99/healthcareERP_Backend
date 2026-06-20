import { Queue } from "bullmq";
import { redis } from "./redis";
import { logger } from "../../config/logger";

const QUEUE_NAME = "ai-processing";

export const aiProcessingQueue = new Queue(QUEUE_NAME, {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000, // 5s, 10s, 20s...
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

/**
 * Enqueue a new medical record processing job
 */
export async function addAIProcessingJob(recordId: string) {
  try {
    const job = await aiProcessingQueue.add("PROCESS_REPORT", { recordId });
    logger.info(`💼 Enqueued AI processing job ${job.id} for record: ${recordId}`);
    return job;
  } catch (error: any) {
    logger.error(`❌ Failed to enqueue job for record ${recordId}:`, error.message);
    throw error;
  }
}
