import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTestSchema, clearTestDb } from "./helpers/testDb.js";
import { db, sqlite } from "../db/index.js";
import { scans, projects, users, scanResults } from "../db/schema.js";
import { v4 as uuid } from "uuid";

// Mock DockerRunner so tests don't need Docker
vi.mock("../server/services/dockerRunner.js", () => ({
  DockerRunner: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.run = vi.fn().mockResolvedValue([]);
  }),
}));

// Mock the queue so no Redis connection is attempted
vi.mock("../server/services/queue.js", () => ({
  scanQueue: {
    add: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
    getJob: vi.fn().mockResolvedValue(null),
  },
  redisConnection: {
    quit: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock the endpoint gateway so tests don't start real HTTP servers
vi.mock("../server/services/endpointGateway.js", () => ({
  gateway: {
    start: vi.fn().mockResolvedValue(19999),
    acquire: vi.fn(),
    release: vi.fn(),
    forceStop: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock Docker detection — tests run outside Docker, so passthrough all URLs
vi.mock("../server/utils/resolveEndpoint.js", () => ({
  isRunningInDocker: vi.fn().mockReturnValue(false),
  resolveForHost: vi.fn().mockImplementation((url: string) => url),
}));

// Mock promptfoo to avoid real AI calls
vi.mock("promptfoo", () => ({
  evaluate: vi.fn().mockResolvedValue({ results: [] }),
  default: { evaluate: vi.fn().mockResolvedValue({ results: [] }) },
}));

// Mock global fetch so probeOllama and direct Ollama calls don't make real
// network requests.  The probe returns "ok" so the scanner takes the fast
// direct path instead of the slow relay-with-retries path.
const _originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("/api/tags")) {
      // Ollama probe — return a valid response so probeOllama() → true
      return new Response(JSON.stringify({ models: [{ name: "llama3" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (typeof url === "string" && url.includes("/api/chat")) {
      // Direct Ollama attack call — return a harmless response
      return new Response(
        JSON.stringify({ message: { content: "I cannot help with that." } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    // Anything else (relay, etc.) — reject immediately
    throw new Error("mock: ECONNREFUSED");
  });
});
afterEach(() => {
  globalThis.fetch = _originalFetch;
});

// Import after mocks are set up
const { ScanOrchestrator } = await import("../server/services/scanner.js");

const TEST_USER_ID = uuid();
const TEST_PROJECT_ID = uuid();

async function seedTestData() {
  const now = new Date();
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: "scanner-test@example.com",
    passwordHash: "hash",
    role: "admin",
    inviteCode: null,
    createdAt: now,
    lastLoginAt: now,
  });

  await db.insert(projects).values({
    id: TEST_PROJECT_ID,
    userId: TEST_USER_ID,
    name: "Test Project",
    description: null,
    targetUrl: "http://localhost:11434",
    providerType: "ollama",
    providerConfig: JSON.stringify({ model: "llama3" }),
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  });
}

describe("ScanOrchestrator", () => {
  beforeEach(async () => {
    applyTestSchema();
    clearTestDb();
    await seedTestData();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("transitions scan status from pending → running → completed", async () => {
    const scanId = uuid();
    await db.insert(scans).values({
      id: scanId,
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER_ID,
      status: "pending",
      preset: "quick",
      plugins: JSON.stringify(["promptfoo:jailbreak"]),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      progress: 0,
      errorMessage: null,
      scheduledAt: null,
      recurrence: null,
      notifyOn: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    });

    const orchestrator = new ScanOrchestrator();
    await orchestrator.run(scanId);

    const { eq } = await import("drizzle-orm");
    const updated = await db.select().from(scans).where(eq(scans.id, scanId)).get();

    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).toBeDefined();
  });

  it("marks scan as failed when project not found", async () => {
    // Create a valid scan first, then delete the referenced project to
    // simulate the race condition of a project being removed after scan creation.
    const scanId = uuid();
    await db.insert(scans).values({
      id: scanId,
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER_ID,
      status: "pending",
      preset: null,
      plugins: JSON.stringify(["promptfoo:jailbreak"]),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      progress: 0,
      errorMessage: null,
      scheduledAt: null,
      recurrence: null,
      notifyOn: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    });

    const { eq } = await import("drizzle-orm");
    // Temporarily disable FK enforcement to delete the project while the scan still references it,
    // simulating the race condition where a project is removed after scan creation.
    sqlite.pragma("foreign_keys = OFF");
    await db.delete(projects).where(eq(projects.id, TEST_PROJECT_ID));
    sqlite.pragma("foreign_keys = ON");

    const orchestrator = new ScanOrchestrator();
    await expect(orchestrator.run(scanId)).rejects.toThrow();

    const updated = await db.select().from(scans).where(eq(scans.id, scanId)).get();
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toBeTruthy();
  });

  it("marks scan as failed when no valid plugins", async () => {
    const scanId = uuid();
    await db.insert(scans).values({
      id: scanId,
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER_ID,
      status: "pending",
      preset: null,
      plugins: JSON.stringify(["unknown:fake-plugin"]),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      progress: 0,
      errorMessage: null,
      scheduledAt: null,
      recurrence: null,
      notifyOn: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    });

    const orchestrator = new ScanOrchestrator();
    await expect(orchestrator.run(scanId)).rejects.toThrow();

    const { eq } = await import("drizzle-orm");
    const updated = await db.select().from(scans).where(eq(scans.id, scanId)).get();
    expect(updated?.status).toBe("failed");
  });

  it("throws when scan ID does not exist", async () => {
    const orchestrator = new ScanOrchestrator();
    await expect(orchestrator.run(uuid())).rejects.toThrow();
  });

  it("calls onProgress callback with 100 when all tools complete", async () => {
    const scanId = uuid();
    await db.insert(scans).values({
      id: scanId,
      projectId: TEST_PROJECT_ID,
      userId: TEST_USER_ID,
      status: "pending",
      preset: "quick",
      plugins: JSON.stringify(["promptfoo:jailbreak"]),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      progress: 0,
      errorMessage: null,
      scheduledAt: null,
      recurrence: null,
      notifyOn: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    });

    const progressValues: number[] = [];
    const orchestrator = new ScanOrchestrator();
    await orchestrator.run(scanId, (p) => {
      progressValues.push(p);
      return Promise.resolve();
    });

    expect(progressValues).toContain(100);
  });
});
