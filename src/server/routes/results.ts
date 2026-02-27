import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans, projects } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

// ─── Provider-agnostic LLM call (shared pattern with remediation route) ──────
// Resolution order:
//   1. Project's own provider (Ollama, OpenAI, Anthropic, custom) — works fully offline
//   2. ANTHROPIC_API_KEY env var as cloud fallback

async function callLLM(
  prompt: string,
  providerType: string,
  targetUrl: string,
  providerConfig: Record<string, unknown>
): Promise<string> {
  const model = (providerConfig.model as string) || "llama3";

  // 1. Try the project's own provider
  try {
    const text = await callProjectProvider(prompt, providerType, targetUrl, providerConfig, model);
    if (text) return text;
  } catch (err) {
    logger.warn(`[Narrative] Project provider (${providerType}) failed: ${err}`);
  }

  // 2. Fall back to Anthropic API if configured
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey: anthropicKey });
      const message = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      if (block?.type === "text") return block.text;
    } catch (err) {
      logger.warn(`[Narrative] Anthropic fallback failed: ${err}`);
    }
  }

  throw new Error(
    "No AI provider available for narrative generation. " +
      "Ensure your project target (e.g., Ollama at http://localhost:11434) is running, " +
      "or set ANTHROPIC_API_KEY for cloud-based generation."
  );
}

async function callProjectProvider(
  prompt: string,
  providerType: string,
  targetUrl: string,
  providerConfig: Record<string, unknown>,
  model: string
): Promise<string | null> {
  switch (providerType) {
    case "ollama": {
      const url = (targetUrl || "http://localhost:11434").replace(/\/+$/, "");
      const ollamaBody = {
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
      };

      // Try direct connection first — works when Ollama and EART are on the same host.
      try {
        const resp = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ollamaBody),
          signal: AbortSignal.timeout(8_000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { message?: { content?: string } };
          return data.message?.content ?? null;
        }
      } catch {
        // Fall through to browser relay.
      }

      // Browser relay fallback — browser on user's machine calls local Ollama.
      const { queueRelayRequest } = await import("../services/ollamaRelay.js");
      const data = (await queueRelayRequest(url, "/api/chat", ollamaBody)) as {
        message?: { content?: string };
      };
      return data.message?.content ?? null;
    }

    case "openai": {
      const apiKey = providerConfig.apiKey as string | undefined;
      if (!apiKey) return null;
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`OpenAI returned ${resp.status}`);
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return data.choices?.[0]?.message?.content ?? null;
    }

    case "anthropic": {
      const apiKey = providerConfig.apiKey as string | undefined;
      if (!apiKey) return null;
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const block = message.content[0];
      return block?.type === "text" ? block.text : null;
    }

    case "custom":
    default: {
      if (!targetUrl) return null;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(providerConfig.headers as Record<string, string> | undefined),
      };
      const apiKey = providerConfig.apiKey as string | undefined;
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const resp = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!resp.ok) throw new Error(`Custom endpoint returned ${resp.status}`);
      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
        message?: { content?: string };
        response?: string;
      };
      return (
        data.choices?.[0]?.message?.content ??
        data.message?.content ??
        data.response ??
        null
      );
    }
  }
}

// ─── GET /api/results/scans/:scanId/summary ───────────────────────────────────
resultsRouter.get("/scans/:scanId/summary", async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({ id: scans.id })
    .from(scans)
    .where(and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) return res.status(404).json({ error: "Scan not found" });

  const results = await db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.scanId))
    .all();

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    bySeverity: {
      critical: results.filter((r) => r.severity === "critical" && !r.passed).length,
      high: results.filter((r) => r.severity === "high" && !r.passed).length,
      medium: results.filter((r) => r.severity === "medium" && !r.passed).length,
      low: results.filter((r) => r.severity === "low" && !r.passed).length,
      info: results.filter((r) => r.severity === "info").length,
    },
    byTool: (["promptfoo", "garak", "pyrit", "deepteam"] as const).reduce(
      (acc, tool) => {
        const toolResults = results.filter((r) => r.tool === tool);
        acc[tool] = {
          total: toolResults.length,
          failed: toolResults.filter((r) => !r.passed).length,
        };
        return acc;
      },
      {} as Record<string, { total: number; failed: number }>
    ),
    byOwaspCategory: results.reduce(
      (acc, r) => {
        const cat = r.owaspCategory ?? "Other";
        if (!acc[cat]) acc[cat] = { total: 0, failed: 0 };
        acc[cat].total++;
        if (!r.passed) acc[cat].failed++;
        return acc;
      },
      {} as Record<string, { total: number; failed: number }>
    ),
  };

  return res.json(summary);
});

// ─── POST /api/results/scans/:scanId/narrative ────────────────────────────────
// Uses the project's own LLM provider (including local Ollama) so this works
// fully offline in air-gapped deployments.
resultsRouter.post("/scans/:scanId/narrative", async (req: AuthenticatedRequest, res) => {
  const scan = await db
    .select({ id: scans.id, status: scans.status, projectId: scans.projectId })
    .from(scans)
    .where(and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id)))
    .get();

  if (!scan) return res.status(404).json({ error: "Scan not found" });
  if (scan.status !== "completed") {
    return res.status(409).json({ error: "Scan must be completed before generating a narrative" });
  }

  // Fetch the project to get its LLM provider configuration
  const project = await db
    .select({
      targetUrl: projects.targetUrl,
      providerType: projects.providerType,
      providerConfig: projects.providerConfig,
    })
    .from(projects)
    .where(eq(projects.id, scan.projectId))
    .get();

  const providerConfig = project ? JSON.parse(project.providerConfig) : {};

  const results = await db
    .select()
    .from(scanResults)
    .where(eq(scanResults.scanId, req.params.scanId))
    .all();

  const total = results.length;
  const failed = results.filter((r) => !r.passed).length;
  const bySeverity = {
    critical: results.filter((r) => r.severity === "critical" && !r.passed).length,
    high: results.filter((r) => r.severity === "high" && !r.passed).length,
    medium: results.filter((r) => r.severity === "medium" && !r.passed).length,
    low: results.filter((r) => r.severity === "low" && !r.passed).length,
  };

  const topFindings = results
    .filter((r) => !r.passed && (r.severity === "critical" || r.severity === "high"))
    .slice(0, 10)
    .map((r) => `- [${r.severity.toUpperCase()}] ${r.testName} (${r.tool}, ${r.owaspCategory ?? "N/A"})`);

  const owaspHits = [...new Set(
    results.filter((r) => !r.passed && r.owaspCategory).map((r) => r.owaspCategory)
  )];

  const prompt = `You are a senior AI security consultant. Analyze the following LLM red team scan results and write a concise executive summary (3-5 paragraphs) for a non-technical stakeholder.

Scan Statistics:
- Total tests run: ${total}
- Failed (vulnerabilities found): ${failed} (${total > 0 ? Math.round((failed / total) * 100) : 0}% failure rate)
- Critical findings: ${bySeverity.critical}
- High findings: ${bySeverity.high}
- Medium findings: ${bySeverity.medium}
- Low findings: ${bySeverity.low}
- OWASP LLM Top 10 categories impacted: ${owaspHits.join(", ") || "none"}

Top critical/high findings:
${topFindings.length > 0 ? topFindings.join("\n") : "None"}

Write the summary covering: overall risk posture, most significant vulnerabilities found, potential business impact, and 2-3 prioritized remediation recommendations. Be direct and actionable. Do not use markdown headers — write in flowing paragraphs.`;

  try {
    const narrative = await callLLM(
      prompt,
      project?.providerType ?? "ollama",
      project?.targetUrl ?? "",
      providerConfig
    );
    return res.json({ narrative });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});
