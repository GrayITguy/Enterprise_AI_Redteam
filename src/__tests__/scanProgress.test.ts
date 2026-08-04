import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    subscribe = vi.fn((_c: string, cb?: (err: Error | null) => void) => {
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
  publishProgress,
  onScanProgress,
  closeScanProgress,
  type ScanProgressEvent,
} from "../server/services/scanProgress.js";

const event = (over: Partial<ScanProgressEvent> = {}): ScanProgressEvent => ({
  scanId: "s1", status: "running", progress: 40, totalTests: 10, passedTests: 4, failedTests: 2, ...over,
});

describe("scanProgress bus", () => {
  beforeEach(() => {
    instances.length = 0;
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await closeScanProgress();
  });

  it("publishes progress to the progress channel", async () => {
    await publishProgress(event());
    const publisher = instances[0]!;
    const [channel, payload] = publisher.publish.mock.calls[0]!;
    expect(channel).toBe("eart:scan:progress");
    expect(JSON.parse(payload as string).scanId).toBe("s1");
  });

  it("routes a Redis message to the matching scan's handler", () => {
    const handler = vi.fn();
    onScanProgress("s1", handler);
    const subscriber = instances[0]!;
    subscriber.handlers.message!("eart:scan:progress", JSON.stringify(event({ progress: 55 })));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].progress).toBe(55);
  });

  it("does not call handlers for other scans", () => {
    const handler = vi.fn();
    onScanProgress("s1", handler);
    const subscriber = instances[0]!;
    subscriber.handlers.message!("eart:scan:progress", JSON.stringify(event({ scanId: "other" })));
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", () => {
    const handler = vi.fn();
    const off = onScanProgress("s1", handler);
    off();
    const subscriber = instances[0]!;
    subscriber.handlers.message!("eart:scan:progress", JSON.stringify(event()));
    expect(handler).not.toHaveBeenCalled();
  });

  it("uses a single subscriber connection across many watchers", () => {
    onScanProgress("s1", vi.fn());
    onScanProgress("s2", vi.fn());
    onScanProgress("s3", vi.fn());
    expect(instances).toHaveLength(1);
  });
});
