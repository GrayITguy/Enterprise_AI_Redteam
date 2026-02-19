import { Worker } from "bullmq";
import { redisConnection, type ScanJobData } from "../services/queue.js";
import { ScanOrchestrator } from "../services/scanner.js";
import { logger } from "../utils/logger.js";

const orchestrator = new ScanOrchestrator();

const worker = new Worker<ScanJobData>(
  "scans",
  async (job) => {
    const { scanId } = job.data;
    logger.info(`[Worker] Processing scan job ${job.id} for scan ${scanId}`);

    await orchestrator.run(scanId, async (progress) => {
      await job.updateProgress(progress);
    });
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

worker.on("completed", (job) => {
  logger.info(`[Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  logger.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
});

worker.on("error", (err) => {
  logger.error(`[Worker] Worker error: ${err.message}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("[Worker] Shutting down gracefully...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("[Worker] Interrupted, shutting down...");
  await worker.close();
  await redisConnection.quit();
  process.exit(0);
});

logger.info("[Worker] Scan worker started, waiting for jobs...");
