import { describe, it, expect, beforeEach } from "vitest";
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

const PROJECT_PAYLOAD = {
  name: "My Test Project",
  description: "A project for testing",
  targetUrl: "http://localhost:11434",
  providerType: "ollama",
  providerConfig: { model: "llama3" },
};

let admin: TestUser;

describe("Projects API", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    admin = await setupAdmin(app);
  });

  describe("GET /api/projects", () => {
    it("returns empty array for new user", async () => {
      const res = await request(app)
        .get("/api/projects")
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 401 without token", async () => {
      const res = await request(app).get("/api/projects");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/projects", () => {
    it("creates a new project and returns it", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send(PROJECT_PAYLOAD);

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("My Test Project");
      expect(res.body.targetUrl).toBe("http://localhost:11434");
      expect(res.body.providerType).toBe("ollama");
      expect(res.body.id).toBeTruthy();
    });

    it("returns 400 for missing required fields", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send({ name: "No URL or provider" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid URL", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send({ ...PROJECT_PAYLOAD, targetUrl: "not-a-url" });
      expect(res.status).toBe(400);
    });

    it("returns 400 for unknown provider type", async () => {
      const res = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send({ ...PROJECT_PAYLOAD, providerType: "unknown-provider" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/projects/:id", () => {
    it("returns the project with recentScans", async () => {
      const created = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send(PROJECT_PAYLOAD);

      const res = await request(app)
        .get(`/api/projects/${created.body.id}`)
        .set(authHeader(admin.token));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
      expect(Array.isArray(res.body.recentScans)).toBe(true);
    });

    it("returns 404 for unknown project", async () => {
      const res = await request(app)
        .get("/api/projects/00000000-0000-0000-0000-000000000000")
        .set(authHeader(admin.token));
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/projects/:id", () => {
    it("updates project name", async () => {
      const created = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send(PROJECT_PAYLOAD);

      const res = await request(app)
        .patch(`/api/projects/${created.body.id}`)
        .set(authHeader(admin.token))
        .send({ name: "Renamed Project" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed Project");
    });
  });

  describe("DELETE /api/projects/:id", () => {
    it("soft-deletes the project (204 response)", async () => {
      const created = await request(app)
        .post("/api/projects")
        .set(authHeader(admin.token))
        .send(PROJECT_PAYLOAD);

      const del = await request(app)
        .delete(`/api/projects/${created.body.id}`)
        .set(authHeader(admin.token));

      expect(del.status).toBe(204);

      // Should no longer appear in list
      const list = await request(app)
        .get("/api/projects")
        .set(authHeader(admin.token));
      const ids = list.body.map((p: { id: string }) => p.id);
      expect(ids).not.toContain(created.body.id);
    });

    it("returns 404 for unknown project", async () => {
      const res = await request(app)
        .delete("/api/projects/00000000-0000-0000-0000-000000000000")
        .set(authHeader(admin.token));
      expect(res.status).toBe(404);
    });
  });
});
