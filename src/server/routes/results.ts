import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans, projects } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { callWithSettingsFallback } from "../services/aiProvider.js";
import { estimateTokens, getContextWindowWithDefault, computeBudget } from "../utils/tokenBudget.js";
import { logger } from "../utils/logger.js";

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

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

  // Determine context window for budget-aware prompt building
  const model = (providerConfig.model as string) || "";
  const providerType = project?.providerType ?? "ollama";
  const contextWindow = getContextWindowWithDefault(model, providerType);

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

  // Adaptively limit findings based on available context budget
  const criticalHighFindings = results
    .filter((r) => !r.passed && (r.severity === "critical" || r.severity === "high"));

  // Start with up to 10, reduce if context is tight
  const basePromptTokens = 350; // approximate tokens for template text
  const tokensPerFinding = 25;  // approximate tokens per finding line
  const outputTokens = 1024;
  const safeWindow = Math.floor(contextWindow * 0.9);
  const availableForFindings = safeWindow - basePromptTokens - outputTokens;
  const maxFindings = Math.max(
    3,
    Math.min(10, Math.floor(availableForFindings / tokensPerFinding))
  );

  const topFindings = criticalHighFindings
    .slice(0, maxFindings)
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

  // Compute dynamic max completion tokens
  const promptTokens = estimateTokens(prompt);
  const budget = computeBudget(promptTokens, contextWindow);
  const maxCompletionTokens = Math.min(budget.maxCompletionTokens, 2048);

  logger.debug(
    `[Narrative] prompt≈${promptTokens}tok, contextWindow=${contextWindow}, ` +
    `maxCompletion=${maxCompletionTokens}, findings=${topFindings.length}`
  );

  try {
    const projectInfo = project
      ? { providerType: project.providerType, targetUrl: project.targetUrl, providerConfig }
      : null;
    const narrative = await callWithSettingsFallback(
      prompt, projectInfo, maxCompletionTokens, contextWindow
    );
    return res.json({ narrative });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});
