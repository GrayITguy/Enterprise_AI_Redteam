import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans, projects } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { callWithSettingsFallback } from "../services/aiProvider.js";

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
    const projectInfo = project
      ? { providerType: project.providerType, targetUrl: project.targetUrl, providerConfig }
      : null;
    const narrative = await callWithSettingsFallback(prompt, projectInfo, 1024);
    return res.json({ narrative });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: msg });
  }
});
