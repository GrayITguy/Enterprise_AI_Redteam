import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { users, projects, scans, scanResults } from "../../db/schema.js";
import { generateToken } from "../../server/middleware/auth.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));

let admin: TestUser;

async function makeUser(role: "admin" | "analyst" | "viewer", email: string): Promise<string> {
  const id = uuid();
  await db.insert(users).values({
    id, email, passwordHash: "x", role, createdAt: new Date(), lastLoginAt: null,
  });
  return id;
}

describe("Users API (admin)", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
  });

  it("lists users without secrets, admin only", async () => {
    await makeUser("analyst", "analyst@example.com");
    const res = await request(app).get("/api/users").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].passwordHash).toBeUndefined();
  });

  it("rejects non-admins", async () => {
    const analystId = await makeUser("analyst", "a@example.com");
    const token = generateToken({ id: analystId, email: "a@example.com", role: "analyst" });
    const res = await request(app).get("/api/users").set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it("changes a user's role", async () => {
    const id = await makeUser("viewer", "v@example.com");
    const res = await request(app)
      .patch(`/api/users/${id}`)
      .set(authHeader(admin.token))
      .send({ role: "analyst" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("analyst");
  });

  it("refuses to demote the last admin", async () => {
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set(authHeader(admin.token))
      .send({ role: "viewer" });
    expect(res.status).toBe(409);
  });

  it("refuses to delete your own account", async () => {
    const res = await request(app).delete(`/api/users/${admin.id}`).set(authHeader(admin.token));
    expect(res.status).toBe(400);
  });

  it("deletes a user and cascades their projects/scans/results", async () => {
    const id = await makeUser("analyst", "gone@example.com");
    const projectId = uuid();
    await db.insert(projects).values({
      id: projectId, userId: id, name: "P", description: null, targetUrl: "http://x",
      providerType: "ollama", providerConfig: "{}", isArchived: false,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const scanId = uuid();
    await db.insert(scans).values({
      id: scanId, projectId, userId: id, status: "completed", plugins: "[]",
      totalTests: 1, passedTests: 0, failedTests: 1, progress: 100, createdAt: new Date(),
    });
    await db.insert(scanResults).values({
      id: uuid(), scanId, tool: "garak", category: "c", severity: "high", testName: "t",
      passed: false, evidence: "{}", createdAt: new Date(),
    });

    const res = await request(app).delete(`/api/users/${id}`).set(authHeader(admin.token));
    expect(res.status).toBe(204);

    expect(await db.select().from(users).where(eq(users.id, id)).get()).toBeUndefined();
    expect(await db.select().from(projects).where(eq(projects.userId, id)).all()).toHaveLength(0);
    expect(await db.select().from(scans).where(eq(scans.id, scanId)).get()).toBeUndefined();
    expect(await db.select().from(scanResults).where(eq(scanResults.scanId, scanId)).all()).toHaveLength(0);
  });
});
