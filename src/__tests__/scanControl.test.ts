import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture every mock Redis client the module constructs. Defined via vi.hoisted
// so the (hoisted) vi.mock factory below can reference it without a TDZ error.
interface MockRedis {
  handlers: Record<string, (...args: unknown[]) => void>;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
}
const { instances } = vi.hoisted(() => ({ instances: [] as MockRedis[] }));

vi.mock("ioredis", () => {
  class MockRedisClient {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    publish = vi.fn().mockResolvedValue(1);
    subscribe = vi.fn((_channel: string, cb?: (err: Error | null) => void) => {
      cb?.(null);
      return Promise.resolve(1);
    });
    on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      this.handlers[event] = cb;
      return this;
    });
    quit = vi.fn().mockResolvedValue("OK");
    constructor() {
      instances.push(this as unknown as MockRedis);
    }
  }
  return { Redis: MockRedisClient };
});

import {
  publishCancel,
  subscribeCancel,
  closeScanControl,
} from "../server/services/scanControl.js";

describe("scanControl pub/sub", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await closeScanControl();
  });

  it("publishes a cancel to the scan-cancel channel with the scanId", async () => {
    await publishCancel("scan-123");
    const publisher = instances[0]!;
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = publisher.publish.mock.calls[0]!;
    expect(message).toBe("scan-123");
    expect(channel).toBe("eart:scan:cancel");
  });

  it("invokes the handler with the scanId on a matching message", () => {
    const handler = vi.fn();
    subscribeCancel(handler);
    const subscriber = instances[0]!;
    const channel = subscriber.subscribe.mock.calls[0]![0] as string;

    subscriber.handlers.message!(channel, "scan-abc");
    expect(handler).toHaveBeenCalledWith("scan-abc");
  });

  it("ignores messages on other channels", () => {
    const handler = vi.fn();
    subscribeCancel(handler);
    const subscriber = instances[0]!;

    subscriber.handlers.message!("some:other:channel", "scan-xyz");
    expect(handler).not.toHaveBeenCalled();
  });

  it("subscribeCancel is idempotent (single subscriber connection)", () => {
    subscribeCancel(vi.fn());
    subscribeCancel(vi.fn());
    expect(instances).toHaveLength(1);
  });

  it("publishCancel swallows Redis errors (DB status remains authoritative)", async () => {
    await publishCancel("first"); // creates the publisher
    const publisher = instances[0]!;
    publisher.publish.mockRejectedValueOnce(new Error("redis down"));
    await expect(publishCancel("second")).resolves.toBeUndefined();
  });
});
