import { Router } from "express";
import { db } from "../../db/index.js";
import { scanResults, scans, projects } from "../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { getPluginById } from "../config/pluginCatalog.js";

import { callWithSettingsFallback } from "../services/aiProvider.js";
import { getSetting } from "../services/settingsService.js";
import { estimateTokens, getContextWindow, computeBudget } from "../utils/tokenBudget.js";
import { logger } from "../utils/logger.js";

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

    // Determine the model and context window for budget-aware prompt building
    const model = (providerConfig.model as string) || "";
    const providerType = project?.providerType ?? "ollama";
    const contextWindow = getContextWindow(model, providerType);

    // Group failures by OWASP category
    const byOwasp = new Map<string, typeof failures>();
    for (const f of failures) {
      const cat = f.owaspCategory ?? "Other";
      if (!byOwasp.has(cat)) byOwasp.set(cat, []);
      byOwasp.get(cat)!.push(f);
    }

    // Sort categories by severity
    const sortedCategories = [...byOwasp.entries()].sort(
      (a, b) => severityScore(b[1]) - severityScore(a[1])
    );

    const failureRate = scan.totalTests > 0
      ? Math.round((scan.failedTests / scan.totalTests) * 100)
      : 0;

    // Build prompt with adaptive detail levels based on token budget
    const prompt = buildAdaptivePrompt(
      sortedCategories,
      project?.name ?? "Unknown",
      providerType,
      systemPrompt,
      scan.totalTests,
      scan.failedTests,
      failureRate,
      contextWindow
    );

    // Compute dynamic max completion tokens from the budget
    const promptTokens = estimateTokens(prompt);
    const budget = computeBudget(promptTokens, contextWindow);
    const maxCompletionTokens = Math.min(budget.maxCompletionTokens, 8192);

    logger.debug(
      `[Remediation] prompt≈${promptTokens}tok, contextWindow=${contextWindow}, ` +
      `maxCompletion=${maxCompletionTokens}, categories=${sortedCategories.length}, ` +
      `failures=${failures.length}`
    );

    try {
      const projectInfo = project
        ? { providerType: project.providerType, targetUrl: project.targetUrl, providerConfig }
        : null;
      const responseText = await callWithSettingsFallback(
        prompt, projectInfo, maxCompletionTokens, contextWindow
      );

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

// ─── Adaptive prompt builder ─────────────────────────────────────────────────

interface CategoryEntry {
  cat: string;
  findings: { severity: string; testName: string; tool: string; prompt: string | null; response: string | null }[];
}

/**
 * Builds a remediation prompt that fits within the given context window.
 * Progressively reduces detail level until the prompt + expected output fits.
 *
 * Reduction levels:
 *   0 — 3 examples/category, 150-char truncation  (current/default)
 *   1 — 2 examples/category, 100-char truncation
 *   2 — 1 example/category, 80-char truncation
 *   3 — No examples, just category name + severity counts
 */
function buildAdaptivePrompt(
  sortedCategories: [string, CategoryEntry["findings"]][],
  projectName: string,
  providerType: string,
  systemPrompt: string,
  totalTests: number,
  failedTests: number,
  failureRate: number,
  contextWindow: number
): string {
  // Try each reduction level until the prompt fits
  for (let level = 0; level <= 3; level++) {
    const prompt = buildPromptAtLevel(
      sortedCategories, projectName, providerType, systemPrompt,
      totalTests, failedTests, failureRate, level, contextWindow
    );
    const promptTokens = estimateTokens(prompt);
    // Reserve space for the expected output (remediation JSON is large)
    const minOutputTokens = level >= 3 ? 2048 : 4096;
    const totalNeeded = promptTokens + minOutputTokens;
    const safeWindow = Math.floor(contextWindow * 0.9);

    if (totalNeeded <= safeWindow) {
      if (level > 0) {
        logger.info(
          `[Remediation] Reduced prompt detail to level ${level} to fit context window ` +
          `(prompt≈${promptTokens}tok, window=${contextWindow})`
        );
      }
      return prompt;
    }
  }

  // Level 3 is the most compact — use it regardless
  logger.warn(
    `[Remediation] Prompt may exceed context window even at minimum detail level (window=${contextWindow})`
  );
  return buildPromptAtLevel(
    sortedCategories, projectName, providerType, systemPrompt,
    totalTests, failedTests, failureRate, 3, contextWindow
  );
}

function buildPromptAtLevel(
  sortedCategories: [string, CategoryEntry["findings"]][],
  projectName: string,
  providerType: string,
  systemPrompt: string,
  totalTests: number,
  failedTests: number,
  failureRate: number,
  level: number,
  contextWindow: number
): string {
  const examplesPerCategory = [3, 2, 1, 0][level] ?? 0;
  const charLimit = [150, 100, 80, 0][level] ?? 0;
  const sysPromptLimit = level >= 2 ? 250 : 500;
  const useCompactOutput = contextWindow <= 16_384 || level >= 3;

  const categoryBlocks = sortedCategories
    .map(([cat, findings]) => {
      const catName = OWASP_NAMES[cat] ?? cat;
      const severityCounts = {
        critical: findings.filter((f) => f.severity === "critical").length,
        high: findings.filter((f) => f.severity === "high").length,
        medium: findings.filter((f) => f.severity === "medium").length,
        low: findings.filter((f) => f.severity === "low").length,
      };

      let examples = "";
      if (examplesPerCategory > 0) {
        examples = "\n" + findings
          .slice(0, examplesPerCategory)
          .map(
            (f) =>
              `  - [${f.severity.toUpperCase()}] ${f.testName} (${f.tool})\n    Attack: ${truncate(f.prompt ?? "", charLimit)}\n    Response: ${truncate(f.response ?? "", charLimit)}`
          )
          .join("\n");
      }

      return `### ${cat} — ${catName}
Severity breakdown: ${JSON.stringify(severityCounts)}
${findings.length} failed tests.${examples}`;
    })
    .join("\n\n");

  const outputSchema = useCompactOutput
    ? COMPACT_OUTPUT_SCHEMA
    : FULL_OUTPUT_SCHEMA;

  const rules = useCompactOutput
    ? COMPACT_RULES
    : FULL_RULES;

  return `You are a senior AI security engineer and LLM safety specialist. Analyze the following red team scan results and generate a comprehensive, actionable remediation plan.

## Context
- Target: ${projectName} (${providerType} provider)
- Current system prompt: """${truncate(systemPrompt, sysPromptLimit)}"""
- Scan results: ${totalTests} total tests, ${failedTests} failures (${failureRate}% failure rate)

## Failed Findings by Category
${categoryBlocks}

## Instructions
Generate a JSON response with exactly this structure (no markdown wrapping, raw JSON only):
${outputSchema}

${rules}`;
}

const FULL_OUTPUT_SCHEMA = `{
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
}`;

const COMPACT_OUTPUT_SCHEMA = `{
  "riskScore": <number 0-100, where 100 is maximum risk>,
  "summary": "<2-3 sentence executive summary of the security posture and most urgent concerns>",
  "categories": [
    {
      "owaspId": "<LLM01-LLM10 or Other>",
      "owaspName": "<human name>",
      "severity": "<critical|high|medium|low>",
      "findingCount": <number>,
      "rootCause": "<1 sentence root cause>",
      "remediation": [
        "<actionable remediation step 1>",
        "<actionable remediation step 2>"
      ],
      "systemPromptFix": "<concrete clause to add to system prompt, or null>",
      "guardrailConfig": "<guardrail recommendation, or null>",
      "priority": "<P0|P1|P2|P3>"
    }
  ]
}`;

const FULL_RULES = `Rules:
- Order categories by priority (P0 first).
- Be extremely specific — no vague advice like "add guardrails." Provide exact text, exact config values, exact rules.
- The systemPromptRecommendation must be a complete, usable system prompt — not a diff or partial.
- For systemPromptFix fields, write the actual text to add (not "add a rule about X").
- Each remediation step should be independently actionable by a developer.
- riskScore: 0-25 = low risk, 26-50 = moderate, 51-75 = high, 76-100 = critical.`;

const COMPACT_RULES = `Rules:
- Order categories by priority (P0 first).
- Be specific — provide exact text and config values, not vague advice.
- For systemPromptFix fields, write the actual text to add.
- Each remediation step should be independently actionable.
- riskScore: 0-25 = low risk, 26-50 = moderate, 51-75 = high, 76-100 = critical.
- Keep responses concise to fit within token limits.`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (max <= 0) return "";
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
