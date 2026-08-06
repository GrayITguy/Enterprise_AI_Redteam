import { Router } from "express";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, getRow, getRows } from "../../db/index.js";
import { auditLog } from "../../db/schema.js";
import { requireAuth, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { asyncHandler, safeJsonParse } from "../utils/helpers.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

export const auditRouter = Router();
auditRouter.use(apiLimiter);
auditRouter.use(requireAuth);
// Admins hold `audit:read` by default; it can be delegated to another user via
// a custom role without granting full admin.
auditRouter.use(requirePermission("audit:read"));

// ─── GET /api/audit ───────────────────────────────────────────────────────────
// Paginated, newest-first. Optional filters: ?action=scan.create&userId=…
auditRouter.get("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;

  const filters = [
    action ? eq(auditLog.action, action) : undefined,
    userId ? eq(auditLog.userId, userId) : undefined,
  ].filter(Boolean);
  const where = filters.length ? and(...(filters as [ReturnType<typeof eq>])) : undefined;

  const rowsQuery = db.select().from(auditLog);
  const rows = await getRows(
    (where ? rowsQuery.where(where) : rowsQuery)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset)
  );

  const countQuery = db.select({ n: sql<number>`count(*)`.as("n") }).from(auditLog);
  const totalRow = await getRow(where ? countQuery.where(where) : countQuery);

  return res.json({
    entries: rows.map((r) => ({ ...r, detail: r.detail ? safeJsonParse(r.detail, {}) : null })),
    total: Number(totalRow?.n ?? 0),
    limit,
    offset,
  });
}));
