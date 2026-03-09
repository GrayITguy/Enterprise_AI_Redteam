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

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PollWaiter {
  resolve: (item: RelayItem | null) => void;
  timeout: NodeJS.Timeout;
}

// ─── State ────────────────────────────────────────────────────────────────────

/** Promises waiting for the browser to return an Ollama response. */
const pendingRequests = new Map<string, PendingRequest>();

/** Queued items not yet picked up by the browser. */
const itemQueue: RelayItem[] = [];

/** Browser long-poll waiters — resolved when an item arrives. */
const pollWaiters: PollWaiter[] = [];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Queue an Ollama request for the browser to fulfill.
 *
 * The browser polls GET /api/ollama/relay/poll, receives this item, calls the
 * real Ollama on the user's machine, then POSTs the result to
 * POST /api/ollama/relay/fulfill.  This function returns a Promise that
 * resolves with that result (or rejects after 120 s).
 */
export function queueRelayRequest(
  ollamaUrl: string,
  path: string,
  body: unknown,
  timeoutMs = getOllamaTimeoutMs()
): Promise<unknown> {
  const requestId = uuid();
  const item: RelayItem = { requestId, ollamaUrl, path, body };

  logger.debug(`[OllamaRelay] Queuing request ${requestId} → ${ollamaUrl}${path}`);

  // Wake a poll waiter immediately if one is waiting, otherwise push to queue.
  if (pollWaiters.length > 0) {
    const waiter = pollWaiters.shift()!;
    clearTimeout(waiter.timeout);
    waiter.resolve(item);
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

    pendingRequests.set(requestId, { resolve, reject, timeout });
  });
}

/**
 * Long-poll: returns the next queued item immediately, or waits up to
 * `timeoutMs` milliseconds before returning null (idle signal).
 */
export function pollNextRequest(timeoutMs = 30_000): Promise<RelayItem | null> {
  if (itemQueue.length > 0) {
    return Promise.resolve(itemQueue.shift()!);
  }

  return new Promise<RelayItem | null>((resolve) => {
    const timeout = setTimeout(() => {
      const idx = pollWaiters.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) pollWaiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);

    pollWaiters.push({ resolve, timeout });
  });
}

/** Resolve a pending relay request with the Ollama response data. */
export function fulfillRelayRequest(requestId: string, data: unknown): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    logger.warn(`[OllamaRelay] fulfillRelayRequest: unknown requestId ${requestId}`);
    return;
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  logger.debug(`[OllamaRelay] Fulfilled request ${requestId}`);
  pending.resolve(data);
}

/** Reject a pending relay request with an error message. */
export function rejectRelayRequest(requestId: string, error: string): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    logger.warn(`[OllamaRelay] rejectRelayRequest: unknown requestId ${requestId}`);
    return;
  }
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  logger.warn(`[OllamaRelay] Rejected request ${requestId}: ${error}`);
  pending.reject(new Error(error));
}
