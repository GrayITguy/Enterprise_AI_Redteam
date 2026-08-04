/**
 * Cross-process scan control via Redis pub/sub.
 *
 * The cancel API runs in the app process, but the running scan (and its
 * AbortController) lives in the worker process — they can't share a JS object.
 * Persisted scan status is the durable source of truth, but polling it only
 * lets the worker notice a cancel *between tools*. This channel delivers the
 * cancel promptly so the worker can abort mid-tool (killing the Docker
 * container immediately), and it fans out to every worker replica so whichever
 * one owns the scan reacts — without any worker↔worker coordination.
 *
 * Best-effort by design: pub/sub is not persisted, so the DB-status fallback in
 * the orchestrator still guarantees a cancel is eventually honoured even if a
 * subscriber is momentarily disconnected when the event is published.
 */
import { Redis as IORedis } from "ioredis";
import { logger } from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const CANCEL_CHANNEL = "eart:scan:cancel";

let publisher: IORedis | null = null;
let subscriber: IORedis | null = null;

function makeClient(): IORedis {
  const client = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  client.on("error", (err: Error) => logger.error(`[ScanControl] Redis error: ${err.message}`));
  return client;
}

/**
 * Publish a cancel signal for a scan. Best-effort — a Redis failure is logged
 * and swallowed because the DB status (set by the caller) remains authoritative.
 */
export async function publishCancel(scanId: string): Promise<void> {
  try {
    if (!publisher) publisher = makeClient();
    await publisher.publish(CANCEL_CHANNEL, scanId);
    logger.debug(`[ScanControl] Published cancel for scan ${scanId}`);
  } catch (err) {
    logger.warn(
      `[ScanControl] Failed to publish cancel for ${scanId} (DB status still applies): ${err}`
    );
  }
}

/**
 * Subscribe to cancel signals. `handler` is invoked with each cancelled scanId;
 * it should abort the scan if this process owns it and ignore it otherwise.
 * Idempotent — a second call is a no-op.
 */
export function subscribeCancel(handler: (scanId: string) => void): void {
  if (subscriber) return;
  subscriber = makeClient();
  subscriber.subscribe(CANCEL_CHANNEL, (err) => {
    if (err) logger.error(`[ScanControl] Failed to subscribe: ${err.message}`);
    else logger.info("[ScanControl] Subscribed to scan-cancel channel");
  });
  subscriber.on("message", (channel: string, message: string) => {
    if (channel === CANCEL_CHANNEL && message) {
      logger.debug(`[ScanControl] Received cancel signal for scan ${message}`);
      handler(message);
    }
  });
}

/** Close both connections (used on graceful shutdown). */
export async function closeScanControl(): Promise<void> {
  await Promise.allSettled([publisher?.quit(), subscriber?.quit()]);
  publisher = null;
  subscriber = null;
}
