import { Router } from "express";
import { z } from "zod";
import { sql, eq, inArray } from "drizzle-orm";
import { db, getRow, getRows, isPostgres } from "../../db/index.js";
import { users, projects, scans, scanResults, reports, inviteCodes, customRoles } from "../../db/schema.js";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../utils/helpers.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { logger } from "../utils/logger.js";
import { audit, clientIp } from "../services/auditService.js";

export const usersRouter = Router();
usersRouter.use(apiLimiter);
usersRouter.use(requireAuth);
usersRouter.use(requireRole("admin"));

const publicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  customRoleId: users.customRoleId,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

// PATCH accepts a base-tier change, a custom-role assignment, or both. At least
// one field must be present. `customRoleId: null` clears the assignment.
const UpdateSchema = z
  .object({
    role: z.enum(["admin", "analyst", "viewer"]).optional(),
    customRoleId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.role !== undefined || v.customRoleId !== undefined, {
    message: "Provide a role and/or customRoleId",
  });

async function countAdmins(): Promise<number> {
  const row = await getRow(db
    .select({ c: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, "admin"))
    );
  return Number(row?.c ?? 0);
}

// ─── GET /api/users ───────────────────────────────────────────────────────────
usersRouter.get("/", asyncHandler(async (_req, res) => {
  const list = await getRows(db.select(publicColumns).from(users).orderBy(users.createdAt));
  res.json(list);
}));

// ─── PATCH /api/users/:id  { role?, customRoleId? } ──────────────────────────
usersRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }

  const target = await getRow(db
    .select({ id: users.id, role: users.role, customRoleId: users.customRoleId })
    .from(users)
    .where(eq(users.id, req.params.id))
    );
  if (!target) return res.status(404).json({ error: "User not found" });

  const updates: Record<string, unknown> = {};
  const detail: Record<string, unknown> = {};

  if (parsed.data.role !== undefined && parsed.data.role !== target.role) {
    // Never leave the platform with zero admins.
    if (target.role === "admin" && parsed.data.role !== "admin" && (await countAdmins()) <= 1) {
      return res.status(409).json({ error: "Cannot change the role of the last remaining admin" });
    }
    updates.role = parsed.data.role;
    detail.role = { from: target.role, to: parsed.data.role };
  }

  if (parsed.data.customRoleId !== undefined) {
    if (parsed.data.customRoleId !== null) {
      const exists = await getRow(db
        .select({ id: customRoles.id })
        .from(customRoles)
        .where(eq(customRoles.id, parsed.data.customRoleId))
        );
      if (!exists) return res.status(400).json({ error: "Unknown custom role" });
    }
    updates.customRoleId = parsed.data.customRoleId;
    detail.customRole = { from: target.customRoleId, to: parsed.data.customRoleId };
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, target.id));
    void audit({
      action: "user.role_change",
      userId: req.user!.id,
      userEmail: req.user!.email,
      targetType: "user",
      targetId: target.id,
      detail,
      ip: clientIp(req),
    });
  }
  const updated = await getRow(db.select(publicColumns).from(users).where(eq(users.id, target.id)));
  return res.json(updated);
}));

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
// Removes the user and cascades their owned data (projects, scans, results,
// reports, invite codes) in a single transaction.
usersRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }

  const target = await getRow(db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, req.params.id))
    );
  if (!target) return res.status(404).json({ error: "User not found" });

  if (target.role === "admin" && (await countAdmins()) <= 1) {
    return res.status(409).json({ error: "Cannot delete the last remaining admin" });
  }

  const userScans = await getRows(db
    .select({ id: scans.id })
    .from(scans)
    .where(eq(scans.userId, target.id))
    );
  const scanIds = userScans.map((s) => s.id);

  // SQLite (better-sqlite3) transactions are synchronous and use `.run()`;
  // Postgres (postgres-js) transactions are async and await each statement.
  // Same statements, one branch per dialect.
  if (isPostgres) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).transaction(async (tx: any) => {
      if (scanIds.length > 0) {
        await tx.delete(reports).where(inArray(reports.scanId, scanIds));
        await tx.delete(scanResults).where(inArray(scanResults.scanId, scanIds));
      }
      await tx.delete(scans).where(eq(scans.userId, target.id));
      await tx.delete(projects).where(eq(projects.userId, target.id));
      // invite_codes.created_by is NOT NULL → delete; used_by is nullable → detach.
      await tx.delete(inviteCodes).where(eq(inviteCodes.createdBy, target.id));
      await tx.update(inviteCodes).set({ usedBy: null }).where(eq(inviteCodes.usedBy, target.id));
      await tx.delete(users).where(eq(users.id, target.id));
    });
  } else {
    db.transaction((tx) => {
      if (scanIds.length > 0) {
        tx.delete(reports).where(inArray(reports.scanId, scanIds)).run();
        tx.delete(scanResults).where(inArray(scanResults.scanId, scanIds)).run();
      }
      tx.delete(scans).where(eq(scans.userId, target.id)).run();
      tx.delete(projects).where(eq(projects.userId, target.id)).run();
      // invite_codes.created_by is NOT NULL → delete; used_by is nullable → detach.
      tx.delete(inviteCodes).where(eq(inviteCodes.createdBy, target.id)).run();
      tx.update(inviteCodes).set({ usedBy: null }).where(eq(inviteCodes.usedBy, target.id)).run();
      tx.delete(users).where(eq(users.id, target.id)).run();
    });
  }

  logger.info(`[Users] User ${target.id} deleted by admin ${req.user!.id} (${scanIds.length} scans removed)`);
  void audit({
    action: "user.delete",
    userId: req.user!.id,
    userEmail: req.user!.email,
    targetType: "user",
    targetId: target.id,
    detail: { scansRemoved: scanIds.length },
    ip: clientIp(req),
  });
  return res.status(204).send();
}));
