import { Router } from "express";
import type { Request, Response } from "express";
import { logger } from "../utils/logger.js";
import { resolveForHost, isRunningInDocker } from "../utils/resolveEndpoint.js";

export const connectivityRouter = Router();

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
connectivityRouter.post("/check", async (req: Request, res: Response) => {
  const { targetUrl, providerType } = req.body as {
    targetUrl?: string;
    providerType?: string;
  };

  if (!targetUrl) {
    res.status(400).json({ error: "targetUrl is required" });
    return;
  }

  const result = await checkEndpoint(targetUrl, providerType);
  res.json(result);
});

async function checkEndpoint(
  targetUrl: string,
  providerType?: string
): Promise<CheckResult> {
  // In Docker, localhost refers to the container — resolve to host.docker.internal
  const rawUrl = targetUrl.replace(/\/+$/, "");
  const baseUrl = resolveForHost(rawUrl);
  const dockerResolved = baseUrl !== rawUrl && isRunningInDocker();
  const start = Date.now();

  // For Ollama targets, probe the /api/tags endpoint
  if (providerType === "ollama" || baseUrl.includes("11434")) {
    try {
      const resp = await fetch(`${baseUrl}/api/tags`, {
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
      const message = err instanceof Error ? err.message : String(err);

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

  // Generic endpoint: try a HEAD request, then fall back to GET
  try {
    const resp = await fetch(baseUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5_000),
    });

    const latencyMs = Date.now() - start;
    return { reachable: resp.ok || resp.status < 500, latencyMs, dockerResolved };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

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
