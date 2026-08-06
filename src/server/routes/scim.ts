/**
 * SCIM 2.0 provisioning endpoints (mounted at /scim/v2).
 *
 * Lets an IdP provision/update/deprovision EART users. Authenticated with a
 * static bearer token (SCIM_TOKEN) — the standard SCIM auth model. The whole
 * router 404s when SCIM_TOKEN is unset, so SCIM is feature-flagged off by
 * default.
 *
 * Supported: Users CRUD (+ PATCH active/role), filtering by userName, and the
 * discovery endpoints (ServiceProviderConfig/ResourceTypes/Schemas).
 * Deprovisioning is a soft-delete (active=false) so scan history is preserved.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { v4 as uuid } from "uuid";
import { eq, sql, asc } from "drizzle-orm";
import { db, getRow, getRows } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { logger } from "../utils/logger.js";
import { audit, clientIp } from "../services/auditService.js";
import {
  toScimUser,
  scimListResponse,
  scimError,
  parseScimUser,
  parseScimPatch,
  type DbUser,
} from "../services/scimService.js";

export const scimRouter = Router();

function scimEnabled(): boolean {
  return Boolean(process.env.SCIM_TOKEN);
}

/** Constant-time bearer-token check against SCIM_TOKEN. */
function scimAuth(req: Request, res: Response, next: NextFunction): void {
  if (!scimEnabled()) {
    res.status(404).json(scimError(404, "SCIM is not configured"));
    return;
  }
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.SCIM_TOKEN ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json(scimError(401, "Invalid SCIM bearer token"));
    return;
  }
  next();
}

scimRouter.use(scimAuth);
// SCIM uses application/scim+json; make sure JSON bodies parse regardless.
scimRouter.use((req, _res, next) => {
  if (typeof req.body === "undefined") req.body = {};
  next();
});

const SENTINEL_HASH = "scim:provisioned:no-password";

function rowToDbUser(u: {
  id: string; email: string; role: string; isActive: boolean;
  externalId?: string | null; createdAt: Date; lastLoginAt?: Date | null;
}): DbUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role as DbUser["role"],
    isActive: u.isActive,
    externalId: u.externalId ?? null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

// ─── Discovery ────────────────────────────────────────────────────────────────

scimRouter.get("/ServiceProviderConfig", (_req, res) => {
  res.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      { type: "oauthbearertoken", name: "OAuth Bearer Token", description: "Static bearer token (SCIM_TOKEN)" },
    ],
  });
});

scimRouter.get("/ResourceTypes", (_req, res) => {
  res.json([
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: "urn:ietf:params:scim:schemas:core:2.0:User",
    },
  ]);
});

scimRouter.get("/Schemas", (_req, res) => {
  res.json([{ id: "urn:ietf:params:scim:schemas:core:2.0:User", name: "User" }]);
});

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /Users  (?filter=userName eq "x", ?startIndex=1&count=100)
scimRouter.get("/Users", async (req, res) => {
  try {
    const startIndex = Math.max(Number(req.query.startIndex) || 1, 1);
    const count = Math.min(Math.max(Number(req.query.count) || 100, 0), 200);

    // Minimal filter support: userName eq "value".
    const filter = typeof req.query.filter === "string" ? req.query.filter : "";
    const m = filter.match(/userName\s+eq\s+"([^"]+)"/i);

    if (m) {
      const email = m[1]!.toLowerCase();
      const u = await getRow(db.select().from(users).where(eq(users.email, email)));
      const resources = u ? [toScimUser(rowToDbUser(u))] : [];
      return res.json(scimListResponse(resources, resources.length, startIndex));
    }

    const totalRow = await getRow(db.select({ n: sql<number>`count(*)`.as("n") }).from(users));
    const total = Number(totalRow?.n ?? 0);
    const rows = await getRows(
      db.select().from(users).orderBy(asc(users.createdAt)).limit(count).offset(startIndex - 1)
    );
    return res.json(scimListResponse(rows.map((u) => toScimUser(rowToDbUser(u))), total, startIndex));
  } catch (err) {
    logger.error(`[SCIM] list failed: ${err}`);
    return res.status(500).json(scimError(500, "Internal error"));
  }
});

scimRouter.get("/Users/:id", async (req, res) => {
  const u = await getRow(db.select().from(users).where(eq(users.id, req.params.id)));
  if (!u) return res.status(404).json(scimError(404, "User not found"));
  return res.json(toScimUser(rowToDbUser(u)));
});

// POST /Users — provision
scimRouter.post("/Users", async (req, res) => {
  const parsed = parseScimUser(req.body as Record<string, unknown>);
  if ("error" in parsed) return res.status(400).json(scimError(400, parsed.error, "invalidValue"));

  const existing = await getRow(db.select().from(users).where(eq(users.email, parsed.email)));
  if (existing) {
    // SCIM: uniqueness conflict.
    return res.status(409).json(scimError(409, "User already exists", "uniqueness"));
  }

  const now = new Date();
  const newUser = {
    id: uuid(),
    email: parsed.email,
    passwordHash: SENTINEL_HASH,
    role: parsed.role ?? "viewer",
    inviteCode: null,
    isActive: parsed.active,
    externalId: parsed.externalId ?? null,
    createdAt: now,
    lastLoginAt: null,
  };
  await db.insert(users).values(newUser);
  void audit({ action: "scim.user_create", targetType: "user", targetId: newUser.id, detail: { email: newUser.email, role: newUser.role, active: newUser.isActive }, ip: clientIp(req) });
  return res.status(201).json(toScimUser(rowToDbUser(newUser)));
});

// PUT /Users/:id — full replace
scimRouter.put("/Users/:id", async (req, res) => {
  const u = await getRow(db.select().from(users).where(eq(users.id, req.params.id)));
  if (!u) return res.status(404).json(scimError(404, "User not found"));

  const parsed = parseScimUser(req.body as Record<string, unknown>);
  if ("error" in parsed) return res.status(400).json(scimError(400, parsed.error, "invalidValue"));

  await db
    .update(users)
    .set({ isActive: parsed.active, ...(parsed.role ? { role: parsed.role } : {}), ...(parsed.externalId ? { externalId: parsed.externalId } : {}) })
    .where(eq(users.id, u.id));
  void audit({ action: "scim.user_replace", targetType: "user", targetId: u.id, detail: { active: parsed.active, role: parsed.role ?? u.role }, ip: clientIp(req) });
  const updated = await getRow(db.select().from(users).where(eq(users.id, u.id)));
  return res.json(toScimUser(rowToDbUser(updated!)));
});

// PATCH /Users/:id — partial (active / role)
scimRouter.patch("/Users/:id", async (req, res) => {
  const u = await getRow(db.select().from(users).where(eq(users.id, req.params.id)));
  if (!u) return res.status(404).json(scimError(404, "User not found"));

  const change = parseScimPatch(req.body as Record<string, unknown>);
  const updates: Record<string, unknown> = {};
  if (change.active !== undefined) updates.isActive = change.active;
  if (change.role) updates.role = change.role;
  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, u.id));
    void audit({ action: "scim.user_patch", targetType: "user", targetId: u.id, detail: { ...change }, ip: clientIp(req) });
  }
  const updated = await getRow(db.select().from(users).where(eq(users.id, u.id)));
  return res.json(toScimUser(rowToDbUser(updated!)));
});

// DELETE /Users/:id — deprovision (soft delete: deactivate, preserve history)
scimRouter.delete("/Users/:id", async (req, res) => {
  const u = await getRow(db.select().from(users).where(eq(users.id, req.params.id)));
  if (!u) return res.status(404).json(scimError(404, "User not found"));
  await db.update(users).set({ isActive: false }).where(eq(users.id, u.id));
  void audit({ action: "scim.user_deprovision", targetType: "user", targetId: u.id, detail: { email: u.email }, ip: clientIp(req) });
  return res.status(204).send();
});
