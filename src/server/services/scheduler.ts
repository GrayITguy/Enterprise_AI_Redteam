import cron from "node-cron";
import { db } from "../../db/index.js";
import { scans } from "../../db/schema.js";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { scanQueue } from "./queue.js";
import { logger } from "../utils/logger.js";

/**
 * Starts a cron job that runs every 5 minutes.
 * Finds all pending scans whose scheduledAt time has passed and enqueues them.
 */
export function startScheduler(): void {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();

      const due = await db
        .select({ id: scans.id })
        .from(scans)
        .where(
          and(
            eq(scans.status, "pending"),
            isNotNull(scans.scheduledAt),
            lte(scans.scheduledAt, now)
          )
        )
        .all();

      if (due.length === 0) return;

      logger.info(`[Scheduler] ${due.length} scheduled scan(s) are due`);

      for (const { id } of due) {
        // Skip if already in the queue (e.g. from a prior scheduler tick)
        const existing = await scanQueue.getJob(id).catch(() => null);
        if (existing) {
          const state = await existing.getState().catch(() => null);
          if (state && state !== "failed") continue;
        }

        await scanQueue.add("run-scan", { scanId: id }, { jobId: id });
        logger.info(`[Scheduler] Enqueued scheduled scan ${id}`);
      }
    } catch (err) {
      logger.error(`[Scheduler] Error during scheduled-scan check: ${err}`);
    }
  });

  logger.info("[Scheduler] Started — checking for scheduled scans every 5 minutes");
}
