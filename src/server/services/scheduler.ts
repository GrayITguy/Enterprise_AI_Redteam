import cron from "node-cron";
import { db, getRows } from "../../db/index.js";
import { scans } from "../../db/schema.js";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { scanQueue } from "./queue.js";
import { logger } from "../utils/logger.js";
import { purgeExpiredData, retentionConfig } from "./retentionService.js";

/**
 * Starts a cron job that runs every 5 minutes.
 * Finds all pending scans whose scheduledAt time has passed and enqueues them.
 */
export function startScheduler(): void {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const now = new Date();

      const due = await getRows(db
        .select({ id: scans.id })
        .from(scans)
        .where(
          and(
            eq(scans.status, "pending"),
            isNotNull(scans.scheduledAt),
            lte(scans.scheduledAt, now)
          )
        )
        );

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

  // Daily data-retention purge (03:15 UTC). No-op unless a retention window is
  // configured; failures are logged but never crash the scheduler.
  cron.schedule("15 3 * * *", async () => {
    const cfg = retentionConfig();
    if (cfg.dataRetentionDays === 0 && cfg.auditRetentionDays === 0) return;
    try {
      await purgeExpiredData();
    } catch (err) {
      logger.error(`[Retention] Daily purge failed: ${err}`);
    }
  });

  logger.info("[Scheduler] Started — scheduled scans every 5 min, retention purge daily");
}
