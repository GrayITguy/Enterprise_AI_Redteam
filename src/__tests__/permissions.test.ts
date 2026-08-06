import { describe, it, expect, beforeEach } from "vitest";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customRoles } from "../db/schema.js";
import { applyTestSchema, clearTestDb } from "./helpers/testDb.js";
import {
  PERMISSION_CATALOG,
  BUILTIN_ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  permissionsForRole,
  roleHasAllPermissions,
  sanitizePermissions,
} from "../server/config/permissions.js";
import {
  resolveEffectivePermissions,
  userHasPermission,
  getCustomRolePermissions,
  invalidatePermissionCache,
} from "../server/services/permissionService.js";

describe("permission catalog", () => {
  it("has a non-empty, unique catalog", () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThan(0);
    const ids = PERMISSION_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("admin holds every catalogued permission; viewer ⊆ analyst ⊆ admin", () => {
    expect(new Set(BUILTIN_ROLE_PERMISSIONS.admin)).toEqual(ALL_PERMISSIONS);
    const viewer = new Set(BUILTIN_ROLE_PERMISSIONS.viewer);
    const analyst = new Set(BUILTIN_ROLE_PERMISSIONS.analyst);
    for (const p of viewer) expect(analyst.has(p)).toBe(true);
    for (const p of analyst) expect(BUILTIN_ROLE_PERMISSIONS.admin.includes(p)).toBe(true);
    // Non-admins must NOT hold admin-only permissions.
    expect(analyst.has("users:manage" as never)).toBe(false);
    expect(analyst.has("audit:read" as never)).toBe(false);
  });

  it("permissionsForRole / roleHasAllPermissions behave", () => {
    expect(permissionsForRole("viewer")).toEqual(BUILTIN_ROLE_PERMISSIONS.viewer);
    expect(permissionsForRole("nonsense")).toEqual([]);
    expect(roleHasAllPermissions("admin")).toBe(true);
    expect(roleHasAllPermissions("analyst")).toBe(false);
  });

  it("sanitizePermissions keeps valid, reports invalid, and de-dupes", () => {
    const { valid, invalid } = sanitizePermissions(["scan:create", "scan:create", "bogus", "audit:read"]);
    expect(valid).toEqual(["scan:create", "audit:read"]);
    expect(invalid).toEqual(["bogus"]);
    expect(sanitizePermissions("not-an-array")).toEqual({ valid: [], invalid: [] });
  });
});

describe("permissionService (effective permissions)", () => {
  beforeEach(() => {
    applyTestSchema();
    clearTestDb();
    invalidatePermissionCache();
  });

  async function makeRole(permissions: string[]): Promise<string> {
    const id = uuid();
    const now = new Date();
    await db.insert(customRoles).values({
      id, name: `role-${id.slice(0, 8)}`, description: null,
      permissions: JSON.stringify(permissions), createdBy: null, createdAt: now, updatedAt: now,
    });
    invalidatePermissionCache();
    return id;
  }

  it("admin resolves to every permission with no DB lookup", async () => {
    const perms = await resolveEffectivePermissions({ role: "admin" });
    expect(new Set(perms)).toEqual(ALL_PERMISSIONS);
  });

  it("a base tier with no custom role resolves to exactly its tier permissions", async () => {
    const perms = await resolveEffectivePermissions({ role: "viewer", customRoleId: null });
    expect(new Set(perms)).toEqual(new Set(BUILTIN_ROLE_PERMISSIONS.viewer));
  });

  it("unions the base tier with an assigned custom role (additive)", async () => {
    const roleId = await makeRole(["scan:create", "audit:read"]);
    const perms = new Set(await resolveEffectivePermissions({ role: "viewer", customRoleId: roleId }));
    // Base viewer floor preserved…
    for (const p of BUILTIN_ROLE_PERMISSIONS.viewer) expect(perms.has(p)).toBe(true);
    // …plus the custom grants.
    expect(perms.has("scan:create")).toBe(true);
    expect(perms.has("audit:read")).toBe(true);
  });

  it("ignores unknown permission ids stored on a role", async () => {
    const roleId = await makeRole(["audit:read", "totally-made-up"]);
    const perms = await getCustomRolePermissions(roleId);
    expect(perms).toContain("audit:read");
    expect(perms).not.toContain("totally-made-up");
  });

  it("userHasPermission reflects tier and custom grants", async () => {
    expect(await userHasPermission({ role: "admin" }, "users:manage")).toBe(true);
    expect(await userHasPermission({ role: "viewer" }, "scan:create")).toBe(false);
    const roleId = await makeRole(["scan:create"]);
    expect(await userHasPermission({ role: "viewer", customRoleId: roleId }, "scan:create")).toBe(true);
  });

  it("reflects role edits after cache invalidation", async () => {
    const roleId = await makeRole(["scan:read"]);
    expect(await userHasPermission({ role: "viewer", customRoleId: roleId }, "audit:read")).toBe(false);
    await db.update(customRoles).set({ permissions: JSON.stringify(["audit:read"]) }).where(
      (await import("drizzle-orm")).eq(customRoles.id, roleId)
    );
    invalidatePermissionCache();
    expect(await userHasPermission({ role: "viewer", customRoleId: roleId }, "audit:read")).toBe(true);
  });
});
