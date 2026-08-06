/**
 * Custom-role management (mounted at /api/roles).
 *
 * Admin-only (guarded by the `roles:manage` permission, which the built-in admin
 * tier always holds — and which an admin can delegate to another user via a
 * custom role). Lets an admin define named permission sets on top of the three
 * built-in tiers and inspect the full permission catalog. Assigning a role to a
 * user happens in the users route (PATCH /api/users/:id).
 */
import { Router } from "express";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { db, getRow, getRows, isPostgres } from "../../db/index.js";
import { customRoles, users } from "../../db/schema.js";
import { requireAuth, requirePermission, type AuthenticatedRequest } from "../middleware/auth.js";
import { apiLimiter } from "../middleware/rateLimiter.js";
import { asyncHandler } from "../utils/helpers.js";
import { audit, clientIp } from "../services/auditService.js";
import { invalidatePermissionCache } from "../services/permissionService.js";
import {
  PERMISSION_CATALOG,
  BUILTIN_ROLE_PERMISSIONS,
  sanitizePermissions,
} from "../config/permissions.js";

export const rolesRouter = Router();
rolesRouter.use(apiLimiter);
rolesRouter.use(requireAuth);
rolesRouter.use(requirePermission("roles:manage"));

const NameSchema = z.string().trim().min(1).max(64);
const CreateSchema = z.object({
  name: NameSchema,
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.string()).default([]),
});
const UpdateSchema = z.object({
  name: NameSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  permissions: z.array(z.string()).optional(),
});

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string;
  createdAt: Date;
  updatedAt: Date;
}

function toApiRole(r: RoleRow): Record<string, unknown> {
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(r.permissions);
    if (Array.isArray(parsed)) permissions = parsed.filter((p) => typeof p === "string");
  } catch { /* stored value is malformed — surface as empty */ }
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ─── GET /api/roles/permissions — the assignable permission catalog ───────────
rolesRouter.get("/permissions", (_req, res) => {
  res.json({
    permissions: PERMISSION_CATALOG,
    builtinRoles: BUILTIN_ROLE_PERMISSIONS,
  });
});

// ─── GET /api/roles — list custom roles ───────────────────────────────────────
rolesRouter.get("/", asyncHandler(async (_req, res) => {
  const rows = await getRows(db.select().from(customRoles).orderBy(customRoles.name));
  res.json((rows as RoleRow[]).map(toApiRole));
}));

// ─── GET /api/roles/:id ───────────────────────────────────────────────────────
rolesRouter.get("/:id", asyncHandler(async (req, res) => {
  const row = await getRow(db.select().from(customRoles).where(eq(customRoles.id, req.params.id)));
  if (!row) return res.status(404).json({ error: "Role not found" });
  return res.json(toApiRole(row as RoleRow));
}));

// ─── POST /api/roles — create ─────────────────────────────────────────────────
rolesRouter.post("/", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }
  const { valid, invalid } = sanitizePermissions(parsed.data.permissions);
  if (invalid.length > 0) {
    return res.status(400).json({ error: "Unknown permissions", details: { invalid } });
  }

  const existing = await getRow(db.select({ id: customRoles.id }).from(customRoles).where(eq(customRoles.name, parsed.data.name)));
  if (existing) return res.status(409).json({ error: "A role with that name already exists" });

  const now = new Date();
  const row = {
    id: uuid(),
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    permissions: JSON.stringify(valid),
    createdBy: req.user!.id,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(customRoles).values(row);
  invalidatePermissionCache();
  void audit({
    action: "role.create", userId: req.user!.id, userEmail: req.user!.email,
    targetType: "role", targetId: row.id,
    detail: { name: row.name, permissions: valid }, ip: clientIp(req),
  });
  return res.status(201).json(toApiRole(row as RoleRow));
}));

// ─── PATCH /api/roles/:id — update ────────────────────────────────────────────
rolesRouter.patch("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
  }
  const target = await getRow(db.select().from(customRoles).where(eq(customRoles.id, req.params.id)));
  if (!target) return res.status(404).json({ error: "Role not found" });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined && parsed.data.name !== (target as RoleRow).name) {
    const clash = await getRow(db.select({ id: customRoles.id }).from(customRoles).where(eq(customRoles.name, parsed.data.name)));
    if (clash) return res.status(409).json({ error: "A role with that name already exists" });
    updates.name = parsed.data.name;
  }
  if (parsed.data.description !== undefined) updates.description = parsed.data.description ?? null;
  if (parsed.data.permissions !== undefined) {
    const { valid, invalid } = sanitizePermissions(parsed.data.permissions);
    if (invalid.length > 0) return res.status(400).json({ error: "Unknown permissions", details: { invalid } });
    updates.permissions = JSON.stringify(valid);
  }

  await db.update(customRoles).set(updates).where(eq(customRoles.id, target.id));
  invalidatePermissionCache();
  void audit({
    action: "role.update", userId: req.user!.id, userEmail: req.user!.email,
    targetType: "role", targetId: target.id,
    detail: { changed: Object.keys(updates).filter((k) => k !== "updatedAt") }, ip: clientIp(req),
  });
  const updated = await getRow(db.select().from(customRoles).where(eq(customRoles.id, target.id)));
  return res.json(toApiRole(updated as RoleRow));
}));

// ─── DELETE /api/roles/:id — delete + unassign from any users ─────────────────
rolesRouter.delete("/:id", asyncHandler(async (req: AuthenticatedRequest, res) => {
  const target = await getRow(db.select().from(customRoles).where(eq(customRoles.id, req.params.id)));
  if (!target) return res.status(404).json({ error: "Role not found" });

  // Detach the role from every user that holds it, then delete it — one
  // transaction per dialect (better-sqlite3 sync .run() vs. postgres-js async).
  if (isPostgres) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).transaction(async (tx: any) => {
      await tx.update(users).set({ customRoleId: null }).where(eq(users.customRoleId, target.id));
      await tx.delete(customRoles).where(eq(customRoles.id, target.id));
    });
  } else {
    db.transaction((tx) => {
      tx.update(users).set({ customRoleId: null }).where(eq(users.customRoleId, target.id)).run();
      tx.delete(customRoles).where(eq(customRoles.id, target.id)).run();
    });
  }
  invalidatePermissionCache();
  void audit({
    action: "role.delete", userId: req.user!.id, userEmail: req.user!.email,
    targetType: "role", targetId: target.id,
    detail: { name: (target as RoleRow).name }, ip: clientIp(req),
  });
  return res.status(204).send();
}));
