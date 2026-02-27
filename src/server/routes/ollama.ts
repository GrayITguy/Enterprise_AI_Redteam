import { Router } from "express";
import type { Request, Response } from "express";

export const ollamaRouter = Router();

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

/**
 * GET /api/ollama/status?url=http://localhost:11434
 *
 * Probes an Ollama instance and returns the list of available models.
 * No auth required — this is a connectivity check, not a data operation.
 */
ollamaRouter.get("/status", async (req: Request, res: Response) => {
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
    const message = err instanceof Error ? err.message : String(err);
    res.json({ running: false, error: message });
  }
});
