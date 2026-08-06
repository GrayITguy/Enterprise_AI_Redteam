/**
 * Effective-permission resolution for the RBAC layer.
 *
 * A user's effective permissions = the permissions of their built-in tier
 * (`users.role`) UNION the permissions of their assigned custom role
 * (`users.customRoleId`), if any. The base tier is a floor; a custom role can
 * only grant additional capability. `admin` always resolves to every permission.
 *
 * Custom roles change rarely but are read on nearly every authorization check,
 * so they are cached in-process with a short TTL and explicit invalidation on
 * write (see `invalidatePermissionCache`).
 */
import { eq } from "drizzle-orm";
import { db, getRow, getRows } from "../../db/index.js";
import { customRoles } from "../../db/schema.js";
import {
  permissionsForRole,
  roleHasAllPermissions,
  ALL_PERMISSIONS,
  type PermissionId,
} from "../config/permissions.js";
import { logger } from "../utils/logger.js";

export interface EffectiveUser {
  role: string;
  customRoleId?: string | null;
}

interface CachedRole {
  id: string;
  name: string;
  permissions: PermissionId[];
}

const CACHE_TTL_MS = 30_000;
let cache: Map<string, CachedRole> | null = null;
let cacheLoadedAt = 0;

function parsePermissions(raw: unknown): PermissionId[] {
  if (typeof raw !== "string") return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((p): p is PermissionId => typeof p === "string" && ALL_PERMISSIONS.has(p));
  } catch {
    return [];
  }
}

/** Force the next lookup to reload custom roles from the database. */
export function invalidatePermissionCache(): void {
  cache = null;
  cacheLoadedAt = 0;
}

async function loadCache(now: number): Promise<Map<string, CachedRole>> {
  const rows = await getRows(db.select().from(customRoles));
  const next = new Map<string, CachedRole>();
  for (const r of rows) {
    next.set(r.id, { id: r.id, name: r.name, permissions: parsePermissions(r.permissions) });
  }
  cache = next;
  cacheLoadedAt = now;
  return next;
}

async function getCache(): Promise<Map<string, CachedRole>> {
  const now = Date.now();
  if (cache && now - cacheLoadedAt < CACHE_TTL_MS) return cache;
  try {
    return await loadCache(now);
  } catch (err) {
    logger.error(`[Permissions] failed to load custom roles: ${err}`);
    // Fall back to whatever we have (possibly empty) so auth still functions.
    return cache ?? new Map();
  }
}

/** Look up a single custom role's permissions (cache-first). */
export async function getCustomRolePermissions(id: string): Promise<PermissionId[]> {
  const c = await getCache();
  const hit = c.get(id);
  if (hit) return hit.permissions;
  // Cache miss (e.g. created moments ago): read straight through.
  const row = await getRow(db.select().from(customRoles).where(eq(customRoles.id, id)));
  return row ? parsePermissions(row.permissions) : [];
}

/** Resolve a user's full effective permission set. */
export async function resolveEffectivePermissions(user: EffectiveUser): Promise<PermissionId[]> {
  if (roleHasAllPermissions(user.role)) {
    return [...ALL_PERMISSIONS] as PermissionId[];
  }
  const base = new Set<PermissionId>(permissionsForRole(user.role));
  if (user.customRoleId) {
    for (const p of await getCustomRolePermissions(user.customRoleId)) base.add(p);
  }
  return [...base];
}

/** Whether a user holds a specific permission. */
export async function userHasPermission(user: EffectiveUser, permission: string): Promise<boolean> {
  if (roleHasAllPermissions(user.role)) return true;
  if ((permissionsForRole(user.role) as readonly string[]).includes(permission)) return true;
  if (user.customRoleId) {
    return (await getCustomRolePermissions(user.customRoleId) as readonly string[]).includes(permission);
  }
  return false;
}

// Re-exported for tests that need to seed and observe cache behaviour.
export const _cacheTtlMs = CACHE_TTL_MS;
