/**
 * Append-only audit trail.
 *
 * Records security-relevant actions (who did what, to what, from where) for
 * compliance and incident review. Writes are best-effort and fire-and-forget:
 * an audit failure must never break the user's request, so `audit()` swallows
 * its own errors after logging them.
 */
import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { auditLog } from "../../db/schema.js";
import { logger } from "../utils/logger.js";

export interface AuditEvent {
  action: string;
  userId?: string | null;
  userEmail?: string | null;
  targetType?: "scan" | "project" | "user" | "settings" | "role" | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/** Record an audit event. Never throws — logs and returns on failure. */
export async function audit(event: AuditEvent): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: uuid(),
      userId: event.userId ?? null,
      userEmail: event.userEmail ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      detail: event.detail ? JSON.stringify(event.detail) : null,
      ip: event.ip ?? null,
      createdAt: new Date(),
    });
  } catch (err) {
    logger.warn(`[Audit] Failed to record '${event.action}': ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Extract a best-effort client IP from an Express request. */
export function clientIp(req: { ip?: string; headers?: Record<string, unknown> }): string | null {
  const fwd = req.headers?.["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.ip ?? null;
}
