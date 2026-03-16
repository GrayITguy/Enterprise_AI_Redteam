import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { resolveForHost, isRunningInDocker } from "../utils/resolveEndpoint.js";
import { requireAuth } from "../middleware/auth.js";
import { errorMessage, asyncHandler } from "../utils/helpers.js";
import { ALLOWED_TARGET_HOSTS } from "../utils/urlValidation.js";
import { apiLimiter } from "../middleware/rateLimiter.js";

export const connectivityRouter = Router();
connectivityRouter.use(apiLimiter);
connectivityRouter.use(requireAuth);

interface CheckResult {
  reachable: boolean;
  latencyMs: number;
  models?: string[];
  error?: string;
  suggestion?: string;
  dockerResolved?: boolean;
}

/**
 * POST /api/connectivity/check
 *
 * Pre-flight connectivity check from the server process.  Verifies whether the
 * backend (and by extension the endpoint gateway) can reach the target.
 *
 * Body: { targetUrl: string, providerType?: string }
 * Response: CheckResult
 */
connectivityRouter.post("/check", asyncHandler(async (req: Request, res: Response) => {
  const { targetUrl, providerType } = req.body as {
    targetUrl?: string;
    providerType?: string;
  };

  if (!targetUrl) {
    res.status(400).json({ error: "targetUrl is required" });
    return;
  }

  // ── Inline SSRF guard (allowlist-based for CodeQL js/request-forgery) ──
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    res.json({
      reachable: false,
      latencyMs: 0,
      error: "Invalid URL format",
      suggestion: "Provide a valid http or https URL.",
    });
    return;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    res.json({
      reachable: false,
      latencyMs: 0,
      error: "Only http and https URLs are allowed",
      suggestion: "Change the URL scheme to http:// or https://.",
    });
    return;
  }

  if (!ALLOWED_TARGET_HOSTS.has(parsedUrl.hostname)) {
    res.json({
      reachable: false,
      latencyMs: 0,
      error: `Host '${parsedUrl.hostname}' is not in the target allowlist`,
      suggestion:
        "Configure the ALLOWED_TARGET_HOSTS environment variable to permit this host.",
    });
    return;
  }
  // ── End SSRF guard ─────────────────────────────────────────────────────

  const result = await checkEndpoint(parsedUrl, providerType);
  res.json(result);
}));

/**
 * Internal helper that performs the actual connectivity probe.
 * Receives a **pre-validated** URL object (hostname already checked against
 * ALLOWED_TARGET_HOSTS in the route handler above).
 */
async function checkEndpoint(
  parsedUrl: URL,
  providerType?: string,
): Promise<CheckResult> {
  // In Docker, localhost refers to the container — resolve to host.docker.internal
  const rawUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, "");
  const baseUrl = resolveForHost(rawUrl);
  const dockerResolved = baseUrl !== rawUrl && isRunningInDocker();
  const start = Date.now();

  // For Ollama targets, probe the /api/tags endpoint
  if (providerType === "ollama" || baseUrl.includes("11434")) {
    try {
      const ollamaTarget = new URL("/api/tags", baseUrl);
      const resp = await fetch(ollamaTarget, {
        signal: AbortSignal.timeout(5_000),
      });

      const latencyMs = Date.now() - start;

      if (!resp.ok) {
        return {
          reachable: false,
          latencyMs,
          dockerResolved,
          error: `Ollama returned HTTP ${resp.status}`,
          suggestion:
            "Ollama is running but returned an error. Check if the Ollama service is healthy.",
        };
      }

      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);

      if (models.length === 0) {
        return {
          reachable: true,
          latencyMs,
          models,
          dockerResolved,
          suggestion:
            "Ollama is running but has no models loaded. Pull a model with: ollama pull llama3",
        };
      }

      return { reachable: true, latencyMs, models, dockerResolved };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = errorMessage(err);

      let suggestion: string;
      if (message.includes("ECONNREFUSED")) {
        suggestion =
          "Connection refused — Ollama is not running. Start it with: ollama serve";
      } else if (message.includes("timeout") || message.includes("abort")) {
        suggestion =
          "Connection timed out — Ollama may be starting up or is unreachable at this address.";
      } else {
        suggestion = `Could not reach Ollama: ${message}`;
      }

      logger.debug(`[Connectivity] Ollama probe failed: ${message}`);
      return { reachable: false, latencyMs, dockerResolved, error: message, suggestion };
    }
  }

  // Generic endpoint: try a HEAD request
  try {
    const genericTarget = new URL(parsedUrl.pathname || "/", baseUrl);
    const resp = await fetch(genericTarget, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });

    const latencyMs = Date.now() - start;
    return { reachable: resp.ok || resp.status < 500, latencyMs, dockerResolved };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = errorMessage(err);

    let suggestion: string;
    if (message.includes("ECONNREFUSED")) {
      suggestion = "Connection refused — the target service is not running at this address.";
    } else if (message.includes("timeout") || message.includes("abort")) {
      suggestion = "Connection timed out — the target may be unreachable from the server.";
    } else {
      suggestion = `Could not reach target: ${message}`;
    }

    return { reachable: false, latencyMs, dockerResolved, error: message, suggestion };
  }
}
