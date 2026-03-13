import { Router } from "express";
import type { Request, Response } from "express";
import {
  queueRelayRequest,
  pollNextRequest,
  fulfillRelayRequest,
  rejectRelayRequest,
} from "../services/ollamaRelay.js";
import { errorMessage, asyncHandler } from "../utils/helpers.js";
import { requireAuth } from "../middleware/auth.js";

export const ollamaRouter = Router();
ollamaRouter.use(requireAuth);

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

/**
 * GET /api/ollama/status?url=http://localhost:11434
 *
 * Probes an Ollama instance and returns the list of available models.
 */
ollamaRouter.get("/status", asyncHandler(async (req: Request, res: Response) => {
  const rawUrl = (req.query.url as string | undefined) ?? "http://localhost:11434";

  // Strip trailing slash so we can safely append /api/tags
  const baseUrl = rawUrl.replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      res.json({ running: false, error: `Ollama returned HTTP ${response.status}` });
      return;
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const models = (data.models ?? []).map((m) => m.name);

    res.json({ running: true, models });
  } catch (err: unknown) {
    const message = errorMessage(err);
    res.json({ running: false, error: message });
  }
}));

// ─── Browser Relay Endpoints ──────────────────────────────────────────────────
//
// These three endpoints form a relay that lets the browser (on the user's
// machine) act as a bridge between the backend/scan-worker and a local Ollama
// instance that the server cannot reach directly.
//
//  POST /api/ollama/relay/forward  — called by scan-worker / backend services;
//                                    queues the request and awaits a browser response
//  GET  /api/ollama/relay/poll     — long-polled by the browser; returns the next item
//  POST /api/ollama/relay/fulfill  — browser posts the Ollama response back here

/**
 * POST /api/ollama/relay/forward
 *
 * Body: { ollamaUrl: string, path: string, body: object }
 * Queues an Ollama API call for the browser relay and waits (up to 120 s) for
 * the browser to fulfill it.  Returns the raw Ollama response JSON.
 */
ollamaRouter.post("/relay/forward", asyncHandler(async (req: Request, res: Response) => {
  const { ollamaUrl, path, body } = req.body as {
    ollamaUrl?: string;
    path?: string;
    body?: unknown;
  };

  if (!ollamaUrl || !path) {
    res.status(400).json({ error: "ollamaUrl and path are required" });
    return;
  }

  try {
    const result = await queueRelayRequest(ollamaUrl, path, body ?? {});
    res.json(result);
  } catch (err: unknown) {
    const message = errorMessage(err);
    res.status(504).json({ error: message });
  }
}));

/**
 * GET /api/ollama/relay/poll
 *
 * Long-poll endpoint for the browser.  Waits up to 30 s for a queued relay
 * request; responds with { requestId, ollamaUrl, path, body } when one is
 * available, or { idle: true } on timeout.
 */
ollamaRouter.get("/relay/poll", asyncHandler(async (_req: Request, res: Response) => {
  const item = await pollNextRequest(30_000);
  if (!item) {
    res.json({ idle: true });
    return;
  }
  res.json(item);
}));

/**
 * POST /api/ollama/relay/fulfill
 *
 * Body: { requestId: string, data?: object, error?: string }
 * Called by the browser after it has fetched the Ollama response.
 */
ollamaRouter.post("/relay/fulfill", (req: Request, res: Response) => {
  const { requestId, data, error } = req.body as {
    requestId?: string;
    data?: unknown;
    error?: string;
  };

  if (!requestId) {
    res.status(400).json({ error: "requestId is required" });
    return;
  }

  if (error) {
    rejectRelayRequest(requestId, error);
  } else {
    fulfillRelayRequest(requestId, data);
  }

  res.json({ ok: true });
});
