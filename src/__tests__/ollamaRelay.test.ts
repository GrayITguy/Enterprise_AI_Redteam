import { describe, it, expect } from "vitest";
import {
  queueRelayRequest,
  pollNextRequest,
  fulfillRelayRequest,
} from "../server/services/ollamaRelay.js";

describe("ollamaRelay per-user scoping", () => {
  it("only delivers a queued item to the owning user's poll", async () => {
    const userA = "user-a";
    const userB = "user-b";

    // User A queues a relay request (the returned promise stays pending until
    // fulfilled — we keep a handle so we can assert on it later).
    const pending = queueRelayRequest(userA, "http://localhost:11434", "/api/chat", { q: 1 }, 10_000);

    // User B must NOT see user A's item.
    const bItem = await pollNextRequest(userB, 30);
    expect(bItem).toBeNull();

    // User A receives their own item.
    const aItem = await pollNextRequest(userA, 30);
    expect(aItem).not.toBeNull();
    expect(aItem!.path).toBe("/api/chat");

    // User B cannot fulfill user A's request — the promise stays pending.
    fulfillRelayRequest(aItem!.requestId, userB, { message: { content: "spoofed" } });
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // The rightful owner fulfills it and the original promise resolves.
    fulfillRelayRequest(aItem!.requestId, userA, { message: { content: "real" } });
    const result = (await pending) as { message: { content: string } };
    expect(result.message.content).toBe("real");
  });

  it("returns idle (null) for a user with no queued items", async () => {
    const item = await pollNextRequest("nobody", 20);
    expect(item).toBeNull();
  });
});
