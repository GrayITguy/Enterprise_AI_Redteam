/**
 * Live scan-progress bus (Redis pub/sub → in-process fan-out).
 *
 * The scan worker publishes progress/status updates for a scan; the app process
 * streams them to any browsers watching that scan over SSE. Like the cancel
 * channel, this crosses the app/worker process boundary and fans out across app
 * replicas. A single Redis subscriber per app process feeds a Node EventEmitter,
 * so N concurrent SSE viewers cost one Redis connection, not N.
 */
import { Redis as IORedis } from "ioredis";
import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PROGRESS_CHANNEL = "eart:scan:progress";

export interface ScanProgressEvent {
  scanId: string;
  status: string;
  progress: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

let publisher: IORedis | null = null;
let subscriber: IORedis | null = null;
const bus = new EventEmitter();
// Many SSE viewers can watch popular scans; lift the default 10-listener cap.
bus.setMaxListeners(0);

function makeClient(): IORedis {
  const client = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  client.on("error", (err: Error) => logger.error(`[ScanProgress] Redis error: ${err.message}`));
  return client;
}

/** Publish a progress update (called by the worker). Best-effort. */
export async function publishProgress(event: ScanProgressEvent): Promise<void> {
  try {
    if (!publisher) publisher = makeClient();
    await publisher.publish(PROGRESS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn(`[ScanProgress] Failed to publish progress for ${event.scanId}: ${err}`);
  }
}

/** Lazily start the single shared subscriber that feeds the in-process bus. */
function ensureSubscriber(): void {
  if (subscriber) return;
  subscriber = makeClient();
  subscriber.subscribe(PROGRESS_CHANNEL, (err) => {
    if (err) logger.error(`[ScanProgress] Failed to subscribe: ${err.message}`);
  });
  subscriber.on("message", (channel: string, message: string) => {
    if (channel !== PROGRESS_CHANNEL) return;
    try {
      const event = JSON.parse(message) as ScanProgressEvent;
      bus.emit(event.scanId, event);
    } catch {
      /* ignore malformed messages */
    }
  });
}

/**
 * Watch progress for one scan. Returns an unsubscribe function. The handler
 * fires for every update published for `scanId` (from any replica/process).
 */
export function onScanProgress(
  scanId: string,
  handler: (event: ScanProgressEvent) => void
): () => void {
  ensureSubscriber();
  bus.on(scanId, handler);
  return () => bus.off(scanId, handler);
}

/** Close both connections (graceful shutdown). */
export async function closeScanProgress(): Promise<void> {
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
  bus.removeAllListeners();
}
