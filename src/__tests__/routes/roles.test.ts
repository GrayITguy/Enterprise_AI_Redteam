import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { v4 as uuid } from "uuid";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { generateToken } from "../../server/middleware/auth.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));

let admin: TestUser;

async function createRole(name: string, permissions: string[]): Promise<string> {
  const res = await request(app).post("/api/roles").set(authHeader(admin.token)).send({ name, permissions });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe("Custom roles API", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
  });

  it("exposes the permission catalog", async () => {
    const res = await request(app).get("/api/roles/permissions").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.permissions.length).toBeGreaterThan(0);
    expect(res.body.builtinRoles.admin).toContain("users:manage");
    expect(res.body.builtinRoles.viewer).not.toContain("users:manage");
  });

  it("creates, lists, reads, updates and deletes a custom role", async () => {
    const id = await createRole("Scan Operator", ["scan:create", "scan:cancel"]);

    const list = await request(app).get("/api/roles").set(authHeader(admin.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].permissions).toEqual(["scan:create", "scan:cancel"]);

    const one = await request(app).get(`/api/roles/${id}`).set(authHeader(admin.token));
    expect(one.status).toBe(200);
    expect(one.body.name).toBe("Scan Operator");

    const patch = await request(app).patch(`/api/roles/${id}`).set(authHeader(admin.token))
      .send({ permissions: ["scan:create", "audit:read"], description: "runs scans + reads audit" });
    expect(patch.status).toBe(200);
    expect(patch.body.permissions).toEqual(["scan:create", "audit:read"]);
    expect(patch.body.description).toBe("runs scans + reads audit");

    const del = await request(app).delete(`/api/roles/${id}`).set(authHeader(admin.token));
    expect(del.status).toBe(204);
    const after = await request(app).get(`/api/roles/${id}`).set(authHeader(admin.token));
    expect(after.status).toBe(404);
  });

  it("rejects unknown permissions and duplicate names", async () => {
    const bad = await request(app).post("/api/roles").set(authHeader(admin.token))
      .send({ name: "Bad", permissions: ["scan:create", "not-real"] });
    expect(bad.status).toBe(400);

    await createRole("Dup", ["scan:read"]);
    const dup = await request(app).post("/api/roles").set(authHeader(admin.token))
      .send({ name: "Dup", permissions: [] });
    expect(dup.status).toBe(409);
  });

  it("requires the roles:manage permission (plain analyst is refused)", async () => {
    const analystToken = generateToken({ id: "u-an", email: "an@test.com", role: "analyst" });
    const res = await request(app).get("/api/roles").set(authHeader(analystToken));
    expect(res.status).toBe(403);
  });

  it("assigns a custom role to a user and clears it", async () => {
    const roleId = await createRole("Auditor", ["audit:read"]);
    // Provision a viewer directly.
    const uid = uuid();
    const now = new Date();
    await db.insert(users).values({
      id: uid, email: "viewer@test.com", passwordHash: "x", role: "viewer",
      inviteCode: null, isActive: true, externalId: null, createdAt: now, lastLoginAt: null,
    });

    const assign = await request(app).patch(`/api/users/${uid}`).set(authHeader(admin.token)).send({ customRoleId: roleId });
    expect(assign.status).toBe(200);
    expect(assign.body.customRoleId).toBe(roleId);

    const clear = await request(app).patch(`/api/users/${uid}`).set(authHeader(admin.token)).send({ customRoleId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.customRoleId).toBeNull();

    // Assigning a non-existent role is rejected.
    const bad = await request(app).patch(`/api/users/${uid}`).set(authHeader(admin.token)).send({ customRoleId: "nope" });
    expect(bad.status).toBe(400);
  });

  it("deleting a role detaches it from assigned users", async () => {
    const roleId = await createRole("Temp", ["audit:read"]);
    const uid = uuid();
    const now = new Date();
    await db.insert(users).values({
      id: uid, email: "v2@test.com", passwordHash: "x", role: "viewer", customRoleId: roleId,
      inviteCode: null, isActive: true, externalId: null, createdAt: now, lastLoginAt: null,
    });
    const del = await request(app).delete(`/api/roles/${roleId}`).set(authHeader(admin.token));
    expect(del.status).toBe(204);
    const u = await request(app).get("/api/users").set(authHeader(admin.token));
    const row = u.body.find((x: { id: string }) => x.id === uid);
    expect(row.customRoleId).toBeNull();
  });
});

describe("fine-grained permission delegation (audit:read)", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
  });

  it("lets a non-admin with a custom role read the audit log; refuses one without", async () => {
    const roleId = await createRole("Compliance", ["audit:read"]);

    // A viewer carrying the custom role in their JWT passes the audit:read guard.
    const delegated = generateToken({ id: "u-c", email: "c@test.com", role: "viewer", customRoleId: roleId });
    const ok = await request(app).get("/api/audit").set(authHeader(delegated));
    expect(ok.status).toBe(200);

    // A viewer without it is refused.
    const plain = generateToken({ id: "u-p", email: "p@test.com", role: "viewer" });
    const denied = await request(app).get("/api/audit").set(authHeader(plain));
    expect(denied.status).toBe(403);
  });
});
