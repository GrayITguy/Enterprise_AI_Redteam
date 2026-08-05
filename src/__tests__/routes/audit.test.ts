import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../server/app.js";
import { generateToken } from "../../server/middleware/auth.js";
import { audit } from "../../server/services/auditService.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));

let admin: TestUser;

describe("Audit API", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
  });

  it("records and returns audit entries, newest first (admin only)", async () => {
    await audit({ action: "scan.create", userId: admin.id, userEmail: "admin@example.com", targetType: "scan", targetId: "s1" });
    await new Promise((r) => setTimeout(r, 5)); // guarantee a distinct createdAt ms
    await audit({ action: "project.delete", userId: admin.id, userEmail: "admin@example.com", targetType: "project", targetId: "p1" });

    const res = await request(app).get("/api/audit").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // Newest first
    expect(res.body.entries[0].action).toBe("project.delete");
    expect(res.body.entries[0].targetId).toBe("p1");
  });

  it("filters by action", async () => {
    await audit({ action: "auth.login", userId: admin.id });
    await audit({ action: "scan.create", userId: admin.id });
    const res = await request(app).get("/api/audit?action=auth.login").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.entries[0].action).toBe("auth.login");
  });

  it("parses JSON detail back into an object", async () => {
    await audit({ action: "user.role_change", userId: admin.id, detail: { from: "analyst", to: "admin" } });
    const res = await request(app).get("/api/audit").set(authHeader(admin.token));
    expect(res.body.entries[0].detail).toEqual({ from: "analyst", to: "admin" });
  });

  it("rejects non-admins", async () => {
    const token = generateToken({ id: "u2", email: "a@example.com", role: "analyst" });
    const res = await request(app).get("/api/audit").set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it("never throws from audit() even on a bad write", async () => {
    // A missing action would violate NOT NULL; audit() must swallow it.
    await expect(audit({ action: undefined as unknown as string })).resolves.toBeUndefined();
  });
});
