import { v4 as uuid } from "uuid";
import { Redis as IORedis } from "ioredis";
import { logger } from "../utils/logger.js";
import { getOllamaTimeoutMs } from "../utils/ollamaTimeout.js";

/**
 * Redis-backed Ollama browser relay.
 *
 * The relay bridges a producer that needs an Ollama completion (the scan worker
 * or the app's remediation/narrative service) with the user's browser, which
 * has access to their local Ollama. Backing it with Redis instead of in-process
 * maps means:
 *   - the scan **worker** enqueues directly (no HTTP self-call to the app, no
 *     minted internal token), and
 *   - poll/fulfill work across app replicas, since a browser polling replica A
 *     and a producer waiting on replica B share the same queue.
 *
 * Mechanism (Redis lists + blocking pops — naturally race-free):
 *   - queue per user:      `eart:relay:q:<userId>`      (producer RPUSH, browser BRPOP)
 *   - response per request:`eart:relay:resp:<requestId>`(browser RPUSH, producer BRPOP)
 *   - owner per request:   `eart:relay:owner:<requestId>` so only the owning user
 *     can fulfill/reject a request (cross-user isolation).
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const queueKey = (userId: string) => `eart:relay:q:${userId}`;
const respKey = (requestId: string) => `eart:relay:resp:${requestId}`;
const ownerKey = (requestId: string) => `eart:relay:owner:${requestId}`;

export interface RelayItem {
  requestId: string;
  ollamaUrl: string;
  path: string;
  body: unknown;
}

/** Shared connection for non-blocking commands (RPUSH/GET/SET/DEL/EXPIRE). */
let cmd: IORedis | null = null;
function client(): IORedis {
  if (!cmd) {
    cmd = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
    cmd.on("error", (err: Error) => logger.error(`[OllamaRelay] Redis error: ${err.message}`));
  }
  return cmd;
}

/** A blocking command (BRPOP) holds its connection for its whole wait, so each
 *  gets a dedicated short-lived connection that is closed when the wait ends. */
function blockingClient(): IORedis {
  const c = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  c.on("error", (err: Error) => logger.error(`[OllamaRelay] Redis (blocking) error: ${err.message}`));
  return c;
}

/**
 * Queue an Ollama request for the owning user's browser and wait for the
 * response. Scoped to `userId`: only that user's browser can receive the item
 * (it polls its own queue) or post a response back (owner check on fulfill).
 * Pass `signal` to abort the wait promptly on scan cancellation.
 */
export async function queueRelayRequest(
  userId: string,
  ollamaUrl: string,
  path: string,
  body: unknown,
  timeoutMs = getOllamaTimeoutMs(),
  signal?: AbortSignal
): Promise<unknown> {
  const requestId = uuid();
  const item: RelayItem = { requestId, ollamaUrl, path, body };
  const ttlSec = Math.ceil(timeoutMs / 1000) + 60;
  const blockSec = Math.max(1, Math.ceil(timeoutMs / 1000));

  logger.debug(`[OllamaRelay] Queuing request ${requestId} (user ${userId}) → ${ollamaUrl}${path}`);

  const c = client();
  await c.set(ownerKey(requestId), userId, "EX", ttlSec);
  await c.rpush(queueKey(userId), JSON.stringify(item));
  await c.expire(queueKey(userId), ttlSec);

  // Block on the response list. A dedicated connection is closed on abort so a
  // cancelled scan doesn't leave the producer waiting up to the full timeout.
  const bc = blockingClient();
  const onAbort = () => void bc.disconnect();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await bc.brpop(respKey(requestId), blockSec);
    if (!res) {
      const secs = Math.round(timeoutMs / 1000);
      throw new Error(
        `Ollama relay timed out after ${secs}s — ensure the EART dashboard is open in ` +
          "your browser so it can forward requests to your local Ollama. " +
          "If the model is very slow, try a faster model or reduce the number of findings."
      );
    }
    const payload = JSON.parse(res[1]) as { data?: unknown; error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload.data;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    bc.quit().catch(() => bc.disconnect());
    c.del(ownerKey(requestId)).catch(() => {});
  }
}

const pollerKey = (userId: string) => `eart:relay:poller:${userId}`;
/** TTL a bit longer than the poll window so a continuously-polling browser
 *  keeps its "present" marker fresh between long-poll cycles. */
const POLLER_TTL_SEC = 50;

/**
 * Long-poll for the given user: returns the next queued item, or null after
 * `timeoutMs` (idle). Scoped by userId — a browser only ever sees its own items.
 * Each poll refreshes a short-lived "a browser is relaying for this user" marker
 * so producers can fail fast instead of blocking when nothing is connected.
 */
export async function pollNextRequest(
  userId: string,
  timeoutMs = 30_000
): Promise<RelayItem | null> {
  await client().set(pollerKey(userId), "1", "EX", POLLER_TTL_SEC).catch(() => {});
  const blockSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const bc = blockingClient();
  try {
    const res = await bc.brpop(queueKey(userId), blockSec);
    if (!res) return null;
    return JSON.parse(res[1]) as RelayItem;
  } finally {
    bc.quit().catch(() => bc.disconnect());
  }
}

/** True if a browser has polled the relay for this user recently (i.e. the
 *  dashboard is open and able to forward requests to their local Ollama). */
export async function isRelayPollerActive(userId: string): Promise<boolean> {
  try {
    return (await client().exists(pollerKey(userId))) === 1;
  } catch {
    return false;
  }
}

/** Verify the caller owns the request before it can settle it. */
async function assertOwner(requestId: string, userId: string, op: string): Promise<boolean> {
  const owner = await client().get(ownerKey(requestId));
  if (!owner) {
    logger.warn(`[OllamaRelay] ${op}: unknown or expired requestId ${requestId}`);
    return false;
  }
  if (owner !== userId) {
    logger.warn(
      `[OllamaRelay] ${op}: user ${userId} attempted to settle request ${requestId} owned by another user — ignored`
    );
    return false;
  }
  return true;
}

/** Deliver the Ollama response for a request (browser → producer). */
export async function fulfillRelayRequest(
  requestId: string,
  userId: string,
  data: unknown
): Promise<void> {
  if (!(await assertOwner(requestId, userId, "fulfillRelayRequest"))) return;
  const c = client();
  await c.rpush(respKey(requestId), JSON.stringify({ data }));
  await c.expire(respKey(requestId), 120);
  logger.debug(`[OllamaRelay] Fulfilled request ${requestId}`);
}

/** Deliver an error for a request (browser → producer). */
export async function rejectRelayRequest(
  requestId: string,
  userId: string,
  error: string
): Promise<void> {
  if (!(await assertOwner(requestId, userId, "rejectRelayRequest"))) return;
  const c = client();
  await c.rpush(respKey(requestId), JSON.stringify({ error }));
  await c.expire(respKey(requestId), 120);
  logger.warn(`[OllamaRelay] Rejected request ${requestId}: ${error}`);
}

/** Close the shared command connection (used on graceful shutdown). */
export async function closeOllamaRelay(): Promise<void> {
  await cmd?.quit().catch(() => {});
  cmd = null;
}
