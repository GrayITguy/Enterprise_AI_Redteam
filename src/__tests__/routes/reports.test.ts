import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { v4 as uuid } from "uuid";
import { eq } from "drizzle-orm";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { scans, scanResults } from "../../db/schema.js";
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

describe("Reports API — formats", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);

    const project = await request(app)
      .post("/api/projects")
      .set(authHeader(admin.token))
      .send({ name: "P", targetUrl: "http://localhost:11434", providerType: "ollama" });
    const scan = await request(app)
      .post("/api/scans")
      .set(authHeader(admin.token))
      .send({ projectId: project.body.id, preset: "quick" });
    scanId = scan.body.id;

    // A report needs a completed scan with some findings.
    await db.update(scans).set({ status: "completed" }).where(eq(scans.id, scanId));
    await db.insert(scanResults).values({
      id: uuid(), scanId, tool: "garak", category: "injection", severity: "critical",
      testName: "prompt injection, \"quoted\", value", owaspCategory: "LLM01",
      prompt: "ignore previous", response: "ok", passed: false, evidence: "{}", createdAt: new Date(),
    });
  });

  for (const format of ["html", "csv", "json", "pdf"] as const) {
    it(`generates and downloads a ${format} report`, async () => {
      const gen = await request(app)
        .post(`/api/reports/${scanId}/generate`)
        .set(authHeader(admin.token))
        .send({ format });

      expect(gen.status).toBe(201);
      expect(gen.body.format).toBe(format);
      expect(gen.body.reportId).toBeTruthy();

      const list = await request(app).get(`/api/reports/${scanId}`).set(authHeader(admin.token));
      expect(list.body.some((r: { format: string }) => r.format === format)).toBe(true);

      const dl = await request(app)
        .get(`/api/reports/${scanId}/download/${gen.body.reportId}`)
        .set(authHeader(admin.token));
      expect(dl.status).toBe(200);
    });
  }

  it("csv escapes quotes/commas and includes a header row", async () => {
    const gen = await request(app)
      .post(`/api/reports/${scanId}/generate`)
      .set(authHeader(admin.token))
      .send({ format: "csv" });
    const dl = await request(app)
      .get(`/api/reports/${scanId}/download/${gen.body.reportId}`)
      .set(authHeader(admin.token));
    const text = dl.text;
    expect(text).toContain("testName,tool,category,severity");
    // the comma/quote-containing test name must be RFC-4180 quoted
    expect(text).toContain('"prompt injection, ""quoted"", value"');
  });

  it("rejects an unsupported format", async () => {
    const res = await request(app)
      .post(`/api/reports/${scanId}/generate`)
      .set(authHeader(admin.token))
      .send({ format: "xml" });
    expect(res.status).toBe(400);
  });
});
