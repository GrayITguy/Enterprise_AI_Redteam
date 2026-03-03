import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans, projects } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { getPluginById } from "../config/pluginCatalog.js";

import { callWithSettingsFallback } from "../services/aiProvider.js";
import { getSetting } from "../services/settingsService.js";

export const remediationRouter = Router();
remediationRouter.use(requireAuth);

const OWASP_NAMES: Record<string, string> = {
  LLM01: "Prompt Injection",
  LLM02: "Insecure Output Handling",
  LLM03: "Training Data Poisoning",
  LLM04: "Model Denial of Service",
  LLM05: "Supply Chain Vulnerabilities",
  LLM06: "Sensitive Information Disclosure",
  LLM07: "Insecure Plugin Design",
  LLM08: "Excessive Agency",
  LLM09: "Overreliance",
  LLM10: "Model Theft",
};

// ─── POST /api/remediation/scans/:scanId/generate ────────────────────────────
// Generates AI-powered remediation guidance for a completed scan's findings.
// Uses the project's own LLM provider (including local Ollama) so this works
// fully offline in air-gapped deployments.
remediationRouter.post(
  "/scans/:scanId/generate",
  async (req: AuthenticatedRequest, res) => {
    // Check if remediation is enabled via admin settings
    const remEnabled = await getSetting("remediation.enabled");
    if (remEnabled === "false") {
      return res.status(403).json({
        error: "AI Remediation has been disabled by the administrator. Enable it in Settings.",
      });
    }

    const scan = await db
      .select({
        id: scans.id,
        status: scans.status,
        projectId: scans.projectId,
        totalTests: scans.totalTests,
        failedTests: scans.failedTests,
      })
      .from(scans)
      .where(
        and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id))
      )
      .get();

    if (!scan) return res.status(404).json({ error: "Scan not found" });
    if (scan.status !== "completed") {
      return res
        .status(409)
        .json({ error: "Scan must be completed before generating remediation guidance" });
    }

    // Fetch the project to understand the target configuration and its LLM provider
    const project = await db
      .select({
        name: projects.name,
        targetUrl: projects.targetUrl,
        providerType: projects.providerType,
        providerConfig: projects.providerConfig,
      })
      .from(projects)
      .where(eq(projects.id, scan.projectId))
      .get();

    const providerConfig = project
      ? JSON.parse(project.providerConfig)
      : {};
    const systemPrompt = (providerConfig.systemPrompt as string) || "(none configured)";

    // Fetch all results
    const results = await db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanId, req.params.scanId))
      .all();

    const failures = results.filter((r) => !r.passed);

    if (failures.length === 0) {
      return res.json({
        plan: {
          riskScore: 0,
          summary: "No vulnerabilities were detected in this scan. Your model's defenses held against all tested attacks.",
          categories: [],
          systemPromptRecommendation: null,
        },
      });
    }

    // Group failures by OWASP category
    const byOwasp = new Map<string, typeof failures>();
    for (const f of failures) {
      const cat = f.owaspCategory ?? "Other";
      if (!byOwasp.has(cat)) byOwasp.set(cat, []);
      byOwasp.get(cat)!.push(f);
    }

    // Build a structured prompt for the LLM
    const categoryBlocks = [...byOwasp.entries()]
      .sort(
        (a, b) =>
          severityScore(b[1]) - severityScore(a[1])
      )
      .map(([cat, findings]) => {
        const catName =
          OWASP_NAMES[cat] ?? cat;
        const severityCounts = {
          critical: findings.filter((f) => f.severity === "critical").length,
          high: findings.filter((f) => f.severity === "high").length,
          medium: findings.filter((f) => f.severity === "medium").length,
          low: findings.filter((f) => f.severity === "low").length,
        };

        const examples = findings
          .slice(0, 3)
          .map(
            (f) =>
              `  - [${f.severity.toUpperCase()}] ${f.testName} (${f.tool})\n    Attack: ${truncate(f.prompt ?? "", 150)}\n    Response: ${truncate(f.response ?? "", 150)}`
          )
          .join("\n");

        return `### ${cat} — ${catName}
Severity breakdown: ${JSON.stringify(severityCounts)}
${findings.length} failed tests. Representative examples:
${examples}`;
      })
      .join("\n\n");

    const failureRate = scan.totalTests > 0
      ? Math.round((scan.failedTests / scan.totalTests) * 100)
      : 0;

    const prompt = `You are a senior AI security engineer and LLM safety specialist. Analyze the following red team scan results and generate a comprehensive, actionable remediation plan.

## Context
- Target: ${project?.name ?? "Unknown"} (${project?.providerType ?? "unknown"} provider)
- Current system prompt: """${truncate(systemPrompt, 500)}"""
- Scan results: ${scan.totalTests} total tests, ${scan.failedTests} failures (${failureRate}% failure rate)

## Failed Findings by Category
${categoryBlocks}

## Instructions
Generate a JSON response with exactly this structure (no markdown wrapping, raw JSON only):
{
  "riskScore": <number 0-100, where 100 is maximum risk>,
  "summary": "<2-3 sentence executive summary of the security posture and most urgent concerns>",
  "categories": [
    {
      "owaspId": "<LLM01-LLM10 or Other>",
      "owaspName": "<human name>",
      "severity": "<critical|high|medium|low>",
      "findingCount": <number>,
      "rootCause": "<1-2 sentence root cause analysis>",
      "remediation": [
        "<specific, actionable remediation step 1>",
        "<specific, actionable remediation step 2>",
        "<specific, actionable remediation step 3>"
      ],
      "systemPromptFix": "<if applicable, a specific clause/instruction to ADD to the system prompt to mitigate this category. Be concrete and copy-pasteable. null if not applicable>",
      "guardrailConfig": "<specific guardrail/filter configuration recommendation, e.g., input/output filtering rules, content policy settings. null if not applicable>",
      "priority": "<P0|P1|P2|P3>"
    }
  ],
  "systemPromptRecommendation": "<a complete, hardened system prompt that incorporates all the systemPromptFix clauses into a coherent whole. This should be a production-ready system prompt the user can copy-paste. If the original system prompt is '(none configured)', create one from scratch.>"
}

Rules:
- Order categories by priority (P0 first).
- Be extremely specific — no vague advice like "add guardrails." Provide exact text, exact config values, exact rules.
- The systemPromptRecommendation must be a complete, usable system prompt — not a diff or partial.
- For systemPromptFix fields, write the actual text to add (not "add a rule about X").
- Each remediation step should be independently actionable by a developer.
- riskScore: 0-25 = low risk, 26-50 = moderate, 51-75 = high, 76-100 = critical.`;

    try {
      const projectInfo = project
        ? { providerType: project.providerType, targetUrl: project.targetUrl, providerConfig }
        : null;
      const responseText = await callWithSettingsFallback(prompt, projectInfo, 4096);

      // Parse the JSON from the LLM response
      const jsonText = extractJSON(responseText);
      let plan: unknown;
      try {
        plan = JSON.parse(jsonText);
      } catch {
        // If JSON parsing fails, return the raw text so the frontend can still display something
        return res.json({
          plan: {
            riskScore: failureRate,
            summary: responseText,
            categories: [],
            systemPromptRecommendation: null,
          },
          raw: true,
        });
      }

      return res.json({ plan });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: msg });
    }
  }
);

// ─── POST /api/remediation/scans/:scanId/verify ──────────────────────────────
// Creates a new scan that re-runs only the failed plugins from the original scan.
remediationRouter.post(
  "/scans/:scanId/verify",
  async (req: AuthenticatedRequest, res) => {
    const { v4: uuid } = await import("uuid");
    const { scanQueue } = await import("../services/queue.js");

    const scan = await db
      .select({
        id: scans.id,
        projectId: scans.projectId,
        status: scans.status,
        plugins: scans.plugins,
      })
      .from(scans)
      .where(
        and(eq(scans.id, req.params.scanId), eq(scans.userId, req.user!.id))
      )
      .get();

    if (!scan) return res.status(404).json({ error: "Scan not found" });
    if (scan.status !== "completed") {
      return res
        .status(409)
        .json({ error: "Can only verify a completed scan" });
    }

    // Get the failed results to determine which plugins to re-run
    const failedResults = await db
      .select({ tool: scanResults.tool, category: scanResults.category })
      .from(scanResults)
      .where(
        and(
          eq(scanResults.scanId, req.params.scanId),
          eq(scanResults.passed, false)
        )
      )
      .all();

    if (failedResults.length === 0) {
      return res
        .status(409)
        .json({ error: "No failed tests to verify — scan is clean" });
    }

    // Map failed results back to plugin IDs
    const originalPlugins: string[] = JSON.parse(scan.plugins);
    const failedTools = new Set(failedResults.map((r) => r.tool));
    const failedCategories = new Set(failedResults.map((r) => r.category));

    // Re-run plugins whose tool+category appeared in failures
    const retestPlugins = originalPlugins.filter((pid) => {
      const plugin = getPluginById(pid);
      if (!plugin) return false;
      return failedTools.has(plugin.tool) && failedCategories.has(plugin.category);
    });

    // If mapping didn't catch everything, fall back to all original plugins from failed tools
    const pluginsToRun =
      retestPlugins.length > 0
        ? retestPlugins
        : originalPlugins.filter((pid) => {
            const plugin = getPluginById(pid);
            return plugin ? failedTools.has(plugin.tool) : false;
          });

    const now = new Date();
    const newScan = {
      id: uuid(),
      projectId: scan.projectId,
      userId: req.user!.id,
      status: "pending" as const,
      preset: null,
      plugins: JSON.stringify(pluginsToRun),
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      progress: 0,
      errorMessage: null,
      scheduledAt: null,
      recurrence: null,
      notifyOn: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
    };

    await db.insert(scans).values(newScan);
    await scanQueue.add("run-scan", { scanId: newScan.id }, { jobId: newScan.id });

    return res.status(201).json({
      ...newScan,
      plugins: pluginsToRun,
      originalScanId: scan.id,
      retestingPluginCount: pluginsToRun.length,
    });
  }
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function severityScore(findings: { severity: string }[]): number {
  const weights: Record<string, number> = {
    critical: 10,
    high: 5,
    medium: 2,
    low: 1,
  };
  return findings.reduce(
    (sum, f) => sum + (weights[f.severity] ?? 0),
    0
  );
}

function extractJSON(text: string): string {
  // Try to extract a JSON block from markdown code fences or raw text
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  // Try to find the outermost { ... }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);

  return text;
}
