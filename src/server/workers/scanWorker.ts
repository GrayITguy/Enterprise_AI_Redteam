import { Worker } from "bullmq";
import { v4 as uuid } from "uuid";
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: redisConnection as any,
    concurrency: 2,
  }
);

worker.on("completed", async (job) => {
  logger.info(`[Worker] Job ${job.id} completed`);

  try {
    const { scanId } = job.data;

    const row = await db
      .select({
        id: scans.id,
        projectId: scans.projectId,
        userId: scans.userId,
        preset: scans.preset,
        plugins: scans.plugins,
        totalTests: scans.totalTests,
        passedTests: scans.passedTests,
        failedTests: scans.failedTests,
        completedAt: scans.completedAt,
        recurrence: scans.recurrence,
        notifyOn: scans.notifyOn,
        projectName: projects.name,
      })
      .from(scans)
      .leftJoin(projects, eq(scans.projectId, projects.id))
      .where(eq(scans.id, scanId))
      .get();

    if (!row) return;

    // ── Email notification (respects notifyOn preference) ─────────────────────
    // null means the scan predates the notifyOn field → preserve old "always" behaviour
    const shouldEmail =
      row.notifyOn === null ||
      row.notifyOn === "always" ||
      (row.notifyOn === "failure" && row.failedTests > 0);

    if (shouldEmail) {
      const user = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, row.userId))
        .get();

      if (user?.email) {
        await sendScanCompleteEmail({
          toEmail: user.email,
          projectName: row.projectName ?? row.id,
          scanId: row.id,
          totalTests: row.totalTests,
          passedTests: row.passedTests,
          failedTests: row.failedTests,
          completedAt: row.completedAt ?? new Date(),
        });
      }
    }

    // ── Recurring scan: schedule the next run ─────────────────────────────────
    if (row.recurrence) {
      const base = row.completedAt ?? new Date();
      let nextRun: Date;
      if (row.recurrence === "daily") {
        nextRun = new Date(base.getTime() + 24 * 60 * 60 * 1000);
      } else if (row.recurrence === "weekly") {
        nextRun = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else {
        // monthly: add ~30 days
        nextRun = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      const nextScanId = uuid();
      await db.insert(scans).values({
        id: nextScanId,
        projectId: row.projectId,
        userId: row.userId,
        status: "pending",
        preset: row.preset ?? null,
        plugins: row.plugins,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        errorMessage: null,
        scheduledAt: nextRun,
        recurrence: row.recurrence,
        notifyOn: row.notifyOn ?? null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date(),
      });
      logger.info(`[Worker] Recurring scan scheduled: ${nextScanId} at ${nextRun.toISOString()}`);
    }
  } catch (err) {
    logger.error(`[Worker] Post-completion processing error: ${err}`);
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
