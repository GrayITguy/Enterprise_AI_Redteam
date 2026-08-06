import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { v4 as uuid } from "uuid";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { scans, scanResults, auditLog, projects, users } from "../../db/schema.js";
import { generateToken } from "../../server/middleware/auth.js";
import {
  retentionConfig,
  shouldStoreResponses,
  purgeExpiredData,
} from "../../server/services/retentionService.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));

let admin: TestUser;
const RET_KEYS = ["DATA_RETENTION_DAYS", "AUDIT_RETENTION_DAYS", "SCAN_STORE_RESPONSES"];
const saved: Record<string, string | undefined> = {};
for (const k of RET_KEYS) saved[k] = process.env[k];

const DAY = 86_400_000;

async function seedScan(id: string, ageDays: number, status = "completed") {
  const projectId = uuid();
  await db.insert(projects).values({
    id: projectId, userId: admin.id, name: "p", description: null,
    targetUrl: "http://x", providerType: "custom", providerConfig: "{}",
    isArchived: false, createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(scans).values({
    id, projectId, userId: admin.id, status: status as "completed",
    preset: null, plugins: "[]", totalTests: 1, passedTests: 1, failedTests: 0,
    progress: 100, errorMessage: null, scheduledAt: null, recurrence: null, notifyOn: null,
    startedAt: null, completedAt: null, createdAt: new Date(Date.now() - ageDays * DAY),
  });
  await db.insert(scanResults).values({
    id: uuid(), scanId: id, tool: "promptfoo", category: "injection", severity: "high",
    testName: "t", owaspCategory: "LLM01", prompt: "p", response: "r", passed: false,
    evidence: "{}", createdAt: new Date(Date.now() - ageDays * DAY),
  });
}

describe("retention service", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
    for (const k of RET_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of RET_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to keep-forever and store-responses", () => {
    const cfg = retentionConfig();
    expect(cfg.dataRetentionDays).toBe(0);
    expect(cfg.auditRetentionDays).toBe(0);
    expect(cfg.storeResponses).toBe(true);
    expect(shouldStoreResponses()).toBe(true);
  });

  it("SCAN_STORE_RESPONSES=false disables response storage", () => {
    process.env.SCAN_STORE_RESPONSES = "false";
    expect(shouldStoreResponses()).toBe(false);
  });

  it("purge is a no-op when retention is disabled", async () => {
    await seedScan(uuid(), 999);
    const out = await purgeExpiredData();
    expect(out.scansDeleted).toBe(0);
  });

  it("purges scans (and their results) older than the window, keeps recent ones", async () => {
    const oldId = uuid();
    const newId = uuid();
    await seedScan(oldId, 40);
    await seedScan(newId, 5);
    process.env.DATA_RETENTION_DAYS = "30";

    const out = await purgeExpiredData();
    expect(out.scansDeleted).toBe(1);

    const remaining = await db.select().from(scans);
    expect(remaining.map((s) => s.id)).toContain(newId);
    expect(remaining.map((s) => s.id)).not.toContain(oldId);
    // The old scan's results are gone too.
    const results = await db.select().from(scanResults);
    expect(results.every((r) => r.scanId !== oldId)).toBe(true);
  });

  it("never purges an in-flight (running) scan even if old", async () => {
    const runningOld = uuid();
    await seedScan(runningOld, 40, "running");
    process.env.DATA_RETENTION_DAYS = "30";
    const out = await purgeExpiredData();
    expect(out.scansDeleted).toBe(0);
  });

  it("purges audit rows older than AUDIT_RETENTION_DAYS", async () => {
    await db.insert(auditLog).values({
      id: uuid(), userId: admin.id, userEmail: "a@x", action: "old.event",
      targetType: null, targetId: null, detail: null, ip: null,
      createdAt: new Date(Date.now() - 100 * DAY),
    });
    await db.insert(auditLog).values({
      id: uuid(), userId: admin.id, userEmail: "a@x", action: "recent.event",
      targetType: null, targetId: null, detail: null, ip: null, createdAt: new Date(),
    });
    process.env.AUDIT_RETENTION_DAYS = "30";
    const out = await purgeExpiredData();
    expect(out.auditDeleted).toBe(1);
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toContain("recent.event");
    expect(actions).not.toContain("old.event");
  });
});

describe("retention API", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
    for (const k of RET_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of RET_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("GET /api/retention returns config (admin only)", async () => {
    const res = await request(app).get("/api/retention").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("dataRetentionDays");
    expect(res.body).toHaveProperty("storeResponses");
  });

  it("rejects non-admins", async () => {
    const token = generateToken({ id: "u2", email: "a@x.com", role: "analyst" });
    const res = await request(app).get("/api/retention").set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it("POST /api/retention/purge runs a purge and reports counts", async () => {
    await seedScan(uuid(), 40);
    process.env.DATA_RETENTION_DAYS = "30";
    const res = await request(app).post("/api/retention/purge").set(authHeader(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.purged.scansDeleted).toBe(1);
  });
});
