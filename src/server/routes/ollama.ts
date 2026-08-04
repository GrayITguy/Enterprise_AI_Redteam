import { Router } from "express";
import type { Request, Response } from "express";
import {
  pollNextRequest,
  fulfillRelayRequest,
  rejectRelayRequest,
} from "../services/ollamaRelay.js";
import { errorMessage, asyncHandler } from "../utils/helpers.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { ALLOWED_TARGET_HOSTS } from "../utils/urlValidation.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

export const ollamaRouter = Router();
ollamaRouter.use(apiLimiter);
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

  // ── Inline SSRF guard (allowlist-based for CodeQL js/request-forgery) ──
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    res.status(400).json({ running: false, error: "Invalid URL format" });
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ running: false, error: "Only http and https URLs are allowed" });
    return;
  }

  if (!ALLOWED_TARGET_HOSTS.has(parsed.hostname)) {
    res.status(400).json({
      running: false,
      error: `Host '${parsed.hostname}' is not in the target allowlist. `
        + "Configure ALLOWED_TARGET_HOSTS to permit additional hosts.",
    });
    return;
  }

  try {
    const fetchUrl = new URL("/api/tags", parsed.origin);
    const response = await fetch(fetchUrl, {
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
// These endpoints form a relay that lets the browser (on the user's machine)
// act as a bridge between the backend/scan-worker and a local Ollama instance
// that the server cannot reach directly. Producers (the scan worker and the
// app's AI services) enqueue directly into the shared Redis queue via
// queueRelayRequest(), so there is no HTTP "forward" endpoint any more.
//
//  GET  /api/ollama/relay/poll     — long-polled by the browser; returns the next item
//  POST /api/ollama/relay/fulfill  — browser posts the Ollama response back here

/**
 * GET /api/ollama/relay/poll
 *
 * Long-poll endpoint for the browser.  Waits up to 30 s for a queued relay
 * request; responds with { requestId, ollamaUrl, path, body } when one is
 * available, or { idle: true } on timeout.
 */
ollamaRouter.get("/relay/poll", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const item = await pollNextRequest(req.user!.id, 30_000);
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
ollamaRouter.post("/relay/fulfill", asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
    await rejectRelayRequest(requestId, req.user!.id, error);
  } else {
    await fulfillRelayRequest(requestId, req.user!.id, data);
  }

  res.json({ ok: true });
}));
