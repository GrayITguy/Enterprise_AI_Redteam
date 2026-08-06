/**
 * Data-retention controls.
 *
 * Two enterprise data-governance levers:
 *   1. Time-based purge — delete scans (and their results/reports/report files)
 *      older than DATA_RETENTION_DAYS, and audit_log rows older than
 *      AUDIT_RETENTION_DAYS. Runs on a daily schedule and on demand (admin).
 *   2. Response minimization — when SCAN_STORE_RESPONSES=false, EART does not
 *      persist the raw prompt/response text of findings (which can contain
 *      sensitive data pulled from the target), keeping only the verdict and
 *      metadata.
 *
 * Both default to safe/off: retention 0 = keep forever; responses stored.
 */
import fsp from "fs/promises";
import { and, lt, inArray } from "drizzle-orm";
import { db, getRows } from "../../db/index.js";
import { scans, scanResults, reports, auditLog } from "../../db/schema.js";
import { logger } from "../utils/logger.js";
import { audit } from "./auditService.js";

export interface RetentionConfig {
  dataRetentionDays: number;
  auditRetentionDays: number;
  storeResponses: boolean;
}

function intEnv(name: string): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function retentionConfig(): RetentionConfig {
  return {
    dataRetentionDays: intEnv("DATA_RETENTION_DAYS"),
    auditRetentionDays: intEnv("AUDIT_RETENTION_DAYS"),
    storeResponses: (process.env.SCAN_STORE_RESPONSES ?? "true").toLowerCase() !== "false",
  };
}

/** Whether raw prompt/response text should be persisted with findings. */
export function shouldStoreResponses(): boolean {
  return retentionConfig().storeResponses;
}

export interface PurgeResult {
  scansDeleted: number;
  resultsDeleted: number;
  reportsDeleted: number;
  reportFilesDeleted: number;
  auditDeleted: number;
}

const DAY_MS = 86_400_000;

/**
 * Delete data past its retention window. Idempotent and safe to run repeatedly;
 * a no-op when both windows are disabled (0). Records an audit event when
 * anything was actually removed.
 */
export async function purgeExpiredData(actor?: { userId?: string; userEmail?: string }): Promise<PurgeResult> {
  const cfg = retentionConfig();
  const out: PurgeResult = {
    scansDeleted: 0,
    resultsDeleted: 0,
    reportsDeleted: 0,
    reportFilesDeleted: 0,
    auditDeleted: 0,
  };

  if (cfg.dataRetentionDays > 0) {
    const cutoff = new Date(Date.now() - cfg.dataRetentionDays * DAY_MS);
    // Only purge terminal scans so an in-flight scan is never deleted mid-run.
    const oldScans = await getRows(
      db.select({ id: scans.id }).from(scans).where(
        and(lt(scans.createdAt, cutoff), inArray(scans.status, ["completed", "failed", "cancelled"]))
      )
    );
    const scanIds = oldScans.map((s) => s.id);
    if (scanIds.length > 0) {
      // Remove report files from disk before deleting their rows.
      const oldReports = await getRows(
        db.select({ id: reports.id, filePath: reports.filePath }).from(reports).where(inArray(reports.scanId, scanIds))
      );
      for (const rep of oldReports) {
        try {
          await fsp.unlink(rep.filePath);
          out.reportFilesDeleted += 1;
        } catch {
          /* file already gone — ignore */
        }
      }
      await db.delete(reports).where(inArray(reports.scanId, scanIds));
      await db.delete(scanResults).where(inArray(scanResults.scanId, scanIds));
      await db.delete(scans).where(inArray(scans.id, scanIds));
      out.scansDeleted = scanIds.length;
      out.reportsDeleted = oldReports.length;
    }
  }

  if (cfg.auditRetentionDays > 0) {
    const cutoff = new Date(Date.now() - cfg.auditRetentionDays * DAY_MS);
    // Count first so the audit record can report how many rows were removed.
    const oldAudit = await getRows(db.select({ id: auditLog.id }).from(auditLog).where(lt(auditLog.createdAt, cutoff)));
    if (oldAudit.length > 0) {
      await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
      out.auditDeleted = oldAudit.length;
    }
  }

  const removedAnything = out.scansDeleted > 0 || out.auditDeleted > 0;
  if (removedAnything) {
    logger.info(
      `[Retention] Purged ${out.scansDeleted} scans, ${out.resultsDeleted} results, ${out.reportsDeleted} reports ` +
        `(${out.reportFilesDeleted} files), ${out.auditDeleted} audit rows`
    );
    void audit({
      action: "retention.purge",
      userId: actor?.userId ?? null,
      userEmail: actor?.userEmail ?? null,
      targetType: null,
      detail: { ...out, dataRetentionDays: cfg.dataRetentionDays, auditRetentionDays: cfg.auditRetentionDays },
    });
  }
  return out;
}
