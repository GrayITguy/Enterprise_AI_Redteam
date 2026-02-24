import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../server/app.js";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";
import { setupAdmin, authHeader } from "../helpers/auth.js";

// Mock queue to avoid Redis dependency
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

describe("POST /api/auth/setup", () => {
  beforeEach(() => {
    applyTestSchema();
    clearTestDb();
  });

  it("creates the first admin and returns a JWT + user object", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ email: "admin@example.com", password: "Password123!" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("admin@example.com");
    expect(res.body.user.role).toBe("admin");
  });

  it("returns 409 when users already exist", async () => {
    await setupAdmin(app);
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ email: "second@example.com", password: "Password123!" });
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ email: "not-an-email", password: "Password123!" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for short password", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ email: "admin@example.com", password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    await setupAdmin(app, "admin@example.com", "Password123!");
  });

  it("returns JWT on valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "Password123!" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("admin@example.com");
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.com", password: "WrongPassword!" });
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "Password123!" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed request", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-valid" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
  });

  it("returns the authenticated user", async () => {
    const admin = await setupAdmin(app);
    const res = await request(app)
      .get("/api/auth/me")
      .set(authHeader(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(admin.email);
    expect(res.body.role).toBe("admin");
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set({ Authorization: "Bearer invalid.token.here" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/invite", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
  });

  it("admin can create an invite code", async () => {
    const admin = await setupAdmin(app);
    const res = await request(app)
      .post("/api/auth/invite")
      .set(authHeader(admin.token))
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^EART-/);
  });

  it("returns 401 without authentication", async () => {
    const res = await request(app).post("/api/auth/invite").send({});
    expect(res.status).toBe(401);
  });
});
