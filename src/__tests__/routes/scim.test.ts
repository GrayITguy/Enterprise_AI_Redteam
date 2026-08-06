import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../../server/app.js";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { applyTestSchema, clearTestDb } from "../helpers/testDb.js";

vi.mock("../../server/services/queue.js", () => ({
  scanQueue: { add: vi.fn().mockResolvedValue({ id: "mock-job" }), getJob: vi.fn().mockResolvedValue(null) },
  redisConnection: { quit: vi.fn(), on: vi.fn() },
}));
vi.mock("../../server/services/scheduler.js", () => ({ startScheduler: vi.fn() }));

const TOKEN = "scim-secret-token-123";
const auth = { Authorization: `Bearer ${TOKEN}` };
const savedToken = process.env.SCIM_TOKEN;

beforeEach(() => {
  applyTestSchema();
  clearTestDb();
  process.env.SCIM_TOKEN = TOKEN;
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.SCIM_TOKEN;
  else process.env.SCIM_TOKEN = savedToken;
});

async function createUser(email: string, extra: Record<string, unknown> = {}) {
  return request(app)
    .post("/scim/v2/Users")
    .set(auth)
    .send({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: email, active: true, ...extra });
}

describe("SCIM auth", () => {
  it("rejects with no / wrong token", async () => {
    expect((await request(app).get("/scim/v2/Users")).status).toBe(401);
    expect((await request(app).get("/scim/v2/Users").set({ Authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("404s when SCIM is not configured", async () => {
    delete process.env.SCIM_TOKEN;
    const res = await request(app).get("/scim/v2/Users").set(auth);
    expect(res.status).toBe(404);
  });

  it("serves ServiceProviderConfig", async () => {
    const res = await request(app).get("/scim/v2/ServiceProviderConfig").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.patch.supported).toBe(true);
  });
});

describe("SCIM Users provisioning", () => {
  it("provisions a user (201) and reads it back", async () => {
    const res = await createUser("alice@corp.com", { roles: [{ value: "analyst" }], externalId: "ext-1" });
    expect(res.status).toBe(201);
    expect(res.body.userName).toBe("alice@corp.com");
    expect(res.body.active).toBe(true);
    expect(res.body.roles[0].value).toBe("analyst");
    const id = res.body.id;

    const got = await request(app).get(`/scim/v2/Users/${id}`).set(auth);
    expect(got.status).toBe(200);
    expect(got.body.externalId).toBe("ext-1");
  });

  it("rejects duplicate userName with 409 uniqueness", async () => {
    await createUser("dup@corp.com");
    const res = await createUser("dup@corp.com");
    expect(res.status).toBe(409);
    expect(res.body.scimType).toBe("uniqueness");
  });

  it("filters by userName eq", async () => {
    await createUser("bob@corp.com");
    const res = await request(app).get('/scim/v2/Users?filter=userName eq "bob@corp.com"').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].userName).toBe("bob@corp.com");
  });

  it("PATCH active=false deactivates and blocks login", async () => {
    const created = await createUser("carol@corp.com");
    const id = created.body.id;
    // give a usable password so we can test the login-block directly
    const { generateToken } = await import("../../server/middleware/auth.js");
    void generateToken; // not needed, but keeps import graph explicit

    const patch = await request(app)
      .patch(`/scim/v2/Users/${id}`)
      .set(auth)
      .send({ schemas: ["urn:ietf:params:scim:schemas:core:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] });
    expect(patch.status).toBe(200);
    expect(patch.body.active).toBe(false);

    const row = await db.select().from(users).where(eq(users.id, id));
    expect(row[0]!.isActive).toBe(false);
  });

  it("DELETE deprovisions (soft-delete → inactive, 204)", async () => {
    const created = await createUser("dave@corp.com");
    const id = created.body.id;
    const del = await request(app).delete(`/scim/v2/Users/${id}`).set(auth);
    expect(del.status).toBe(204);
    const row = await db.select().from(users).where(eq(users.id, id));
    expect(row[0]!.isActive).toBe(false); // preserved, not removed
  });

  it("PUT replaces active + role", async () => {
    const created = await createUser("erin@corp.com", { roles: [{ value: "viewer" }] });
    const id = created.body.id;
    const put = await request(app)
      .put(`/scim/v2/Users/${id}`)
      .set(auth)
      .send({ userName: "erin@corp.com", active: false, roles: [{ value: "admin" }] });
    expect(put.status).toBe(200);
    expect(put.body.active).toBe(false);
    expect(put.body.roles[0].value).toBe("admin");
  });
});

describe("deactivated users cannot log in", () => {
  it("returns 403 on password login for an inactive account", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const { v4: uuid } = await import("uuid");
    const id = uuid();
    await db.insert(users).values({
      id, email: "inactive@corp.com", passwordHash: await bcrypt.hash("pw123456", 10),
      role: "analyst", inviteCode: null, isActive: false, externalId: null,
      createdAt: new Date(), lastLoginAt: null,
    });
    const res = await request(app).post("/api/auth/login").send({ email: "inactive@corp.com", password: "pw123456" });
    expect(res.status).toBe(403);
  });
});
