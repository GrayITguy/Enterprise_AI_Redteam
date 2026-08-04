import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A tiny shared in-memory Redis stand-in (lists + key/value), shared across all
// mock client instances so the module's command + blocking connections agree.
const { store } = vi.hoisted(() => ({
  store: {
    lists: {} as Record<string, string[]>,
    kv: {} as Record<string, string>,
    /** When set, a BRPOP on a resp:* key returns this payload once. */
    nextResp: null as string | null,
  },
}));

vi.mock("ioredis", () => {
  class MockRedisClient {
    rpush = vi.fn(async (key: string, val: string) => {
      (store.lists[key] ??= []).push(val);
      return store.lists[key]!.length;
    });
    brpop = vi.fn(async (key: string, _timeout: number) => {
      if (key.startsWith("eart:relay:resp:")) {
        if (store.nextResp !== null) {
          const v = store.nextResp;
          store.nextResp = null;
          return [key, v];
        }
        return null;
      }
      const list = store.lists[key];
      if (list && list.length) return [key, list.shift()!];
      return null;
    });
    set = vi.fn(async (k: string, v: string) => {
      store.kv[k] = v;
      return "OK";
    });
    get = vi.fn(async (k: string) => store.kv[k] ?? null);
    del = vi.fn(async (k: string) => {
      delete store.kv[k];
      return 1;
    });
    expire = vi.fn(async () => 1);
    quit = vi.fn(async () => "OK");
    disconnect = vi.fn();
    on = vi.fn();
  }
  return { Redis: MockRedisClient };
});

import {
  queueRelayRequest,
  pollNextRequest,
  fulfillRelayRequest,
  rejectRelayRequest,
  closeOllamaRelay,
} from "../server/services/ollamaRelay.js";

describe("ollamaRelay (Redis-backed)", () => {
  beforeEach(() => {
    store.lists = {};
    store.kv = {};
    store.nextResp = null;
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await closeOllamaRelay();
  });

  it("enqueues a request scoped to the owning user and records ownership", async () => {
    store.nextResp = JSON.stringify({ data: { message: { content: "hi" } } });
    const result = (await queueRelayRequest("user-a", "http://localhost:11434", "/api/chat", {
      x: 1,
    })) as { message: { content: string } };

    expect(result.message.content).toBe("hi");
    // The prompt was enqueued onto user-a's queue for their browser to pick up.
    const queued = store.lists["eart:relay:q:user-a"];
    expect(queued).toHaveLength(1);
    expect(queued![0]).toContain("/api/chat");
    // Ownership was recorded then cleaned up once the request settled.
    expect(Object.keys(store.kv).some((k) => k.startsWith("eart:relay:owner:"))).toBe(false);
  });

  it("throws a helpful timeout when no response arrives", async () => {
    store.nextResp = null; // BRPOP on resp returns null
    await expect(
      queueRelayRequest("user-a", "http://localhost:11434", "/api/chat", {}, 1000)
    ).rejects.toThrow(/relay timed out/i);
  });

  it("surfaces a browser-reported error as a rejection", async () => {
    store.nextResp = JSON.stringify({ error: "ollama unreachable" });
    await expect(
      queueRelayRequest("user-a", "http://localhost:11434", "/api/chat", {})
    ).rejects.toThrow(/ollama unreachable/);
  });

  it("poll returns the next queued item for that user, or null when idle", async () => {
    store.lists["eart:relay:q:user-a"] = [
      JSON.stringify({ requestId: "r1", ollamaUrl: "u", path: "/api/chat", body: {} }),
    ];
    const item = await pollNextRequest("user-a", 1000);
    expect(item?.requestId).toBe("r1");

    const idle = await pollNextRequest("user-b", 1000);
    expect(idle).toBeNull();
  });

  it("fulfill only succeeds for the owning user (cross-user isolation)", async () => {
    store.kv["eart:relay:owner:req-1"] = "user-a";

    // Wrong user: ignored, no response written.
    await fulfillRelayRequest("req-1", "user-b", { spoofed: true });
    expect(store.lists["eart:relay:resp:req-1"]).toBeUndefined();

    // Owner: response written to the request's response list.
    await fulfillRelayRequest("req-1", "user-a", { real: true });
    expect(store.lists["eart:relay:resp:req-1"]).toHaveLength(1);
    expect(store.lists["eart:relay:resp:req-1"]![0]).toContain("real");
  });

  it("reject is also owner-scoped and writes an error payload", async () => {
    store.kv["eart:relay:owner:req-2"] = "user-a";
    await rejectRelayRequest("req-2", "user-b", "nope");
    expect(store.lists["eart:relay:resp:req-2"]).toBeUndefined();

    await rejectRelayRequest("req-2", "user-a", "real error");
    expect(store.lists["eart:relay:resp:req-2"]![0]).toContain("real error");
  });

  it("ignores settlement of an unknown/expired request", async () => {
    await fulfillRelayRequest("ghost", "user-a", { x: 1 });
    expect(store.lists["eart:relay:resp:ghost"]).toBeUndefined();
  });
});
