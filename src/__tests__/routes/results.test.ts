import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { v4 as uuid } from "uuid";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { scanResults } from "../../db/schema.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));
vi.mock("../../server/services/scanControl.js", () => ({
  publishCancel: vi.fn().mockResolvedValue(undefined),
  subscribeCancel: vi.fn(),
  closeScanControl: vi.fn().mockResolvedValue(undefined),
}));

let admin: TestUser;
let scanId: string;

async function seedScan(): Promise<string> {
  const project = await request(app)
    .post("/api/projects")
    .set(authHeader(admin.token))
    .send({ name: "P", targetUrl: "http://localhost:11434", providerType: "ollama" });
  const scan = await request(app)
    .post("/api/scans")
    .set(authHeader(admin.token))
    .send({ projectId: project.body.id, preset: "quick" });
  return scan.body.id as string;
}

async function insertResult(overrides: Partial<typeof scanResults.$inferInsert>): Promise<void> {
  await db.insert(scanResults).values({
    id: uuid(),
    scanId,
    tool: "garak",
    category: "encoding",
    severity: "high",
    testName: "t",
    owaspCategory: "LLM01",
    prompt: null,
    response: null,
    passed: false,
    evidence: "{}",
    createdAt: new Date(),
    ...overrides,
  });
}

describe("Results & pagination", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
    scanId = await seedScan();
  });

  describe("GET /api/scans/:id/results (paginated)", () => {
    it("returns a paginated envelope with total, limit and offset", async () => {
      for (let i = 0; i < 5; i++) await insertResult({ testName: `t${i}` });

      const res = await request(app)
        .get(`/api/scans/${scanId}/results`)
        .query({ limit: 2, offset: 0 })
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.limit).toBe(2);
      expect(res.body.offset).toBe(0);
      // evidence is parsed to an object
      expect(typeof res.body.results[0].evidence).toBe("object");
    });

    it("respects offset for paging", async () => {
      for (let i = 0; i < 3; i++) await insertResult({});
      const res = await request(app)
        .get(`/api/scans/${scanId}/results`)
        .query({ limit: 2, offset: 2 })
        .set(authHeader(admin.token));
      expect(res.body.total).toBe(3);
      expect(res.body.results).toHaveLength(1);
    });
  });

  describe("GET /api/results/scans/:id/summary (SQL aggregation)", () => {
    it("aggregates totals, severity, tool and OWASP breakdowns", async () => {
      await insertResult({ passed: true, severity: "info", tool: "garak", owaspCategory: "LLM01" });
      await insertResult({ passed: false, severity: "critical", tool: "garak", owaspCategory: "LLM01" });
      await insertResult({ passed: false, severity: "high", tool: "pyrit", owaspCategory: null });

      const res = await request(app)
        .get(`/api/results/scans/${scanId}/summary`)
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.passed).toBe(1);
      expect(res.body.failed).toBe(2);
      expect(res.body.bySeverity.critical).toBe(1);
      expect(res.body.bySeverity.high).toBe(1);
      // a passing info finding must NOT be counted as a failure
      expect(res.body.bySeverity.info).toBe(0);
      expect(res.body.byTool.garak).toEqual({ total: 2, failed: 1 });
      expect(res.body.byTool.pyrit).toEqual({ total: 1, failed: 1 });
      expect(res.body.byOwaspCategory.LLM01).toEqual({ total: 2, failed: 1 });
      expect(res.body.byOwaspCategory.Other).toEqual({ total: 1, failed: 1 });
    });
  });
});
