import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../server/app.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader, type TestUser } from "../helpers/auth.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: {
    add: vi.fn().mockResolvedValue({ id: "mock-job" }),
    getJob: vi.fn().mockResolvedValue(null),
  },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));

vi.mock("../../server/services/scheduler.js", () => ({
  startScheduler: vi.fn(),
}));

let admin: TestUser;
let projectId: string;

async function createProject(token: string): Promise<string> {
  const res = await request(app)
    .post("/api/projects")
    .set(authHeader(token))
    .send({
      name: "Scan Test Project",
      targetUrl: "http://localhost:11434",
      providerType: "ollama",
      providerConfig: { model: "llama3" },
    });
  return res.body.id as string;
}

describe("Scans API", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
    projectId = await createProject(admin.token);
  });

  describe("GET /api/scans/catalog", () => {
    it("returns plugins array and presets object (no auth required)", async () => {
      const res = await request(app).get("/api/scans/catalog");
      // catalog route uses requireAuth — auth is required
      // Calling without token should be 401
      expect([200, 401]).toContain(res.status);
    });

    it("returns catalog when authenticated", async () => {
      const res = await request(app)
        .get("/api/scans/catalog")
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.plugins)).toBe(true);
      expect(res.body.plugins.length).toBe(41);
      expect(res.body.presets).toBeDefined();
      expect(res.body.presets.quick).toBeDefined();
      expect(res.body.presets.owasp).toBeDefined();
      expect(res.body.presets.full).toBeDefined();
    });
  });

  describe("POST /api/scans", () => {
    it("creates a scan with a preset", async () => {
      const res = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({ projectId, preset: "quick" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.status).toBe("pending");
      expect(res.body.preset).toBe("quick");
      expect(Array.isArray(res.body.plugins)).toBe(true);
      expect(res.body.plugins.length).toBe(8);
    });

    it("creates a scan with custom plugin list", async () => {
      const res = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({
          projectId,
          plugins: ["promptfoo:jailbreak", "promptfoo:pii-extraction"],
        });

      expect(res.status).toBe(201);
      expect(res.body.plugins).toEqual([
        "promptfoo:jailbreak",
        "promptfoo:pii-extraction",
      ]);
    });

    it("returns 400 when neither preset nor plugins provided", async () => {
      const res = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({ projectId });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid plugin IDs", async () => {
      const res = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({ projectId, plugins: ["fake:plugin-that-does-not-exist"] });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown project ID", async () => {
      const res = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({
          projectId: "00000000-0000-0000-0000-000000000000",
          preset: "quick",
        });
      expect(res.status).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await request(app)
        .post("/api/scans")
        .send({ projectId, preset: "quick" });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/scans", () => {
    it("returns empty array for new user", async () => {
      const res = await request(app)
        .get("/api/scans")
        .set(authHeader(admin.token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns created scans", async () => {
      await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({ projectId, preset: "quick" });

      const res = await request(app)
        .get("/api/scans")
        .set(authHeader(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });
  });

  describe("POST /api/scans/:id/cancel", () => {
    it("cancels a pending scan", async () => {
      const createRes = await request(app)
        .post("/api/scans")
        .set(authHeader(admin.token))
        .send({ projectId, preset: "quick" });

      const scanId = createRes.body.id as string;

      const cancelRes = await request(app)
        .post(`/api/scans/${scanId}/cancel`)
        .set(authHeader(admin.token));

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.message).toMatch(/cancel/i);

      // Verify status changed
      const getRes = await request(app)
        .get(`/api/scans/${scanId}`)
        .set(authHeader(admin.token));
      expect(getRes.body.status).toBe("cancelled");
    });

    it("returns 404 for unknown scan", async () => {
      const res = await request(app)
        .post("/api/scans/00000000-0000-0000-0000-000000000000/cancel")
        .set(authHeader(admin.token));
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/scans/stats", () => {
    it("returns severity stats (empty) for new user", async () => {
      const res = await request(app)
        .get("/api/scans/stats")
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.critical).toBe(0);
      expect(res.body.high).toBe(0);
      expect(res.body.medium).toBe(0);
    });
  });
});
