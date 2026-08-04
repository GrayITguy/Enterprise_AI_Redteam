import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger.js";
import { getOllamaTimeoutMs } from "../utils/ollamaTimeout.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayItem {
  requestId: string;
  ollamaUrl: string;
  path: string;
  body: unknown;
}

/** Internal queue entry — carries the owning user so items are never shared. */
interface QueuedItem extends RelayItem {
  userId: string;
}

interface PendingRequest {
  userId: string;
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PollWaiter {
  userId: string;
  resolve: (item: RelayItem | null) => void;
  timeout: NodeJS.Timeout;
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Promises waiting for the browser to return an Ollama response. */
const pendingRequests = new Map<string, PendingRequest>();

/** Queued items not yet picked up by the browser. */
const itemQueue: QueuedItem[] = [];

/** Browser long-poll waiters — resolved when an item arrives. */
const pollWaiters: PollWaiter[] = [];

/** Strip the internal `userId` before an item is handed to a browser. */
function toRelayItem(q: QueuedItem): RelayItem {
  return { requestId: q.requestId, ollamaUrl: q.ollamaUrl, path: q.path, body: q.body };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Queue an Ollama request for the owning user's browser to fulfill.
 *
 * Every request is scoped to `userId`: only that user's browser (polling with
 * their own JWT) can receive the item or post a response back for it. This
 * prevents one authenticated user from siphoning another user's scan prompts
 * off the queue or injecting fabricated LLM responses into their results.
 */
export function queueRelayRequest(
  userId: string,
  ollamaUrl: string,
  path: string,
  body: unknown,
  timeoutMs = getOllamaTimeoutMs()
): Promise<unknown> {
  const requestId = uuid();
  const item: QueuedItem = { requestId, userId, ollamaUrl, path, body };

  logger.debug(`[OllamaRelay] Queuing request ${requestId} (user ${userId}) → ${ollamaUrl}${path}`);

  // Wake a poll waiter belonging to the SAME user, otherwise push to the queue.
  const waiterIdx = pollWaiters.findIndex((w) => w.userId === userId);
  if (waiterIdx !== -1) {
    const [waiter] = pollWaiters.splice(waiterIdx, 1);
    clearTimeout(waiter!.timeout);
    waiter!.resolve(toRelayItem(item));
  } else {
    itemQueue.push(item);
  }

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingRequests.delete(requestId)) {
        const secs = Math.round(timeoutMs / 1000);
        reject(
          new Error(
            `Ollama relay timed out after ${secs}s — ensure the EART dashboard is open in ` +
              "your browser so it can forward requests to your local Ollama. " +
              "If the model is very slow, try a faster model or reduce the number of findings."
          )
        );
      }
    }, timeoutMs);

    pendingRequests.set(requestId, { userId, resolve, reject, timeout });
  });
}

/**
 * Long-poll for the given user: returns the next queued item owned by `userId`
 * immediately, or waits up to `timeoutMs` before returning null (idle signal).
 */
export function pollNextRequest(userId: string, timeoutMs = 30_000): Promise<RelayItem | null> {
  const idx = itemQueue.findIndex((i) => i.userId === userId);
  if (idx !== -1) {
    const [item] = itemQueue.splice(idx, 1);
    return Promise.resolve(toRelayItem(item!));
  }

  return new Promise<RelayItem | null>((resolve) => {
    const timeout = setTimeout(() => {
      const wIdx = pollWaiters.findIndex((w) => w.resolve === resolve);
      if (wIdx !== -1) pollWaiters.splice(wIdx, 1);
      resolve(null);
    }, timeoutMs);

    pollWaiters.push({ userId, resolve, timeout });
  });
}

/**
 * Look up a pending request, verify it belongs to `userId`, and remove it from
 * the map (clearing its timeout). Returns null — with a warning — when the id is
 * unknown or owned by another user, so a user can only settle their own request.
 */
function takeOwnedPending(
  requestId: string,
  userId: string,
  op: string
): PendingRequest | null {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    logger.warn(`[OllamaRelay] ${op}: unknown requestId ${requestId}`);
    return null;
  }
  if (pending.userId !== userId) {
    logger.warn(
      `[OllamaRelay] ${op}: user ${userId} attempted to settle request ${requestId} owned by another user — ignored`
    );
    return null;
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  return pending;
}

/**
 * Resolve a pending relay request with the Ollama response data.
 * The `userId` must match the user who queued the request, otherwise the call
 * is ignored — a user can only fulfill their own requests.
 */
export function fulfillRelayRequest(requestId: string, userId: string, data: unknown): void {
  const pending = takeOwnedPending(requestId, userId, "fulfillRelayRequest");
  if (!pending) return;
  logger.debug(`[OllamaRelay] Fulfilled request ${requestId}`);
  pending.resolve(data);
}

/**
 * Reject a pending relay request with an error message.
 * Scoped to the owning user, exactly like {@link fulfillRelayRequest}.
 */
export function rejectRelayRequest(requestId: string, userId: string, error: string): void {
  const pending = takeOwnedPending(requestId, userId, "rejectRelayRequest");
  if (!pending) return;
  logger.warn(`[OllamaRelay] Rejected request ${requestId}: ${error}`);
  pending.reject(new Error(error));
}
