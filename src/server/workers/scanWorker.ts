import { Worker } from "bullmq";
import { redisConnection, type ScanJobData } from "../services/queue.js";
import { ScanOrchestrator } from "../services/scanner.js";
import { logger } from "../utils/logger.js";
import { db } from "../../db/index.js";
import { scans, projects, users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { sendScanCompleteEmail } from "../services/emailService.js";

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

worker.on("completed", async (job) => {
  logger.info(`[Worker] Job ${job.id} completed`);

  // Send scan-complete email notification
  try {
    const { scanId } = job.data;

    const row = await db
      .select({
        id: scans.id,
        userId: scans.userId,
        totalTests: scans.totalTests,
        passedTests: scans.passedTests,
        failedTests: scans.failedTests,
        completedAt: scans.completedAt,
        projectName: projects.name,
      })
      .from(scans)
      .leftJoin(projects, eq(scans.projectId, projects.id))
      .where(eq(scans.id, scanId))
      .get();

    if (!row) return;

    const user = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.userId))
      .get();

    if (!user?.email) return;

    await sendScanCompleteEmail({
      toEmail: user.email,
      projectName: row.projectName ?? row.id,
      scanId: row.id,
      totalTests: row.totalTests,
      passedTests: row.passedTests,
      failedTests: row.failedTests,
      completedAt: row.completedAt ?? new Date(),
    });
  } catch (err) {
    logger.error(`[Worker] Failed to send completion email: ${err}`);
  }
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
