import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { scans, scanResults, projects } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resolvePlugins, getPluginById, type PluginTool } from "../config/pluginCatalog.js";
import { DockerRunner } from "./dockerRunner.js";
import { gateway } from "./endpointGateway.js";
import { logger } from "../utils/logger.js";
import { resolveForHost } from "../utils/resolveEndpoint.js";
import { isLocalhostUrl, errorMessage, resolveOllamaUrl, safeJsonParse } from "../utils/helpers.js";
import { assertUrlNotBlocked } from "../utils/urlValidation.js";
import { PLUGIN_ATTACKS } from "../config/attackPatterns.js";
import { getOllamaTimeoutMs } from "../utils/ollamaTimeout.js";

// Our plugin IDs → promptfoo display names
const PLUGIN_DISPLAY: Record<string, string> = {
  "promptfoo:prompt-injection": "prompt-injection",
  "promptfoo:indirect-prompt-injection": "indirect-prompt-injection",
  "promptfoo:jailbreak": "jailbreak",
  "promptfoo:pii-extraction": "pii-extraction",
  "promptfoo:system-prompt-leak": "system-prompt-leak",
  "promptfoo:rbac-bypass": "rbac-bypass",
  "promptfoo:harmful-content": "harmful-content",
  "promptfoo:overreliance": "overreliance",
  "promptfoo:ascii-smuggling": "ascii-smuggling",
  "promptfoo:debug-access": "debug-access",
  "promptfoo:bola": "bola",
  "promptfoo:bfla": "bfla",
  "promptfoo:contracts": "contracts",
  "promptfoo:shell-injection": "shell-injection",
  "promptfoo:sql-injection": "sql-injection",
};

// ─── Estimate total tests before scanning begins ─────────────────────────────
/** Count the expected number of individual test results for a set of plugins. */
function estimateTotalTests(pluginIds: string[]): number {
  let total = 0;
  for (const pluginId of pluginIds) {
    if (pluginId.startsWith("promptfoo:")) {
      const pfId = PLUGIN_DISPLAY[pluginId] ?? pluginId.replace("promptfoo:", "");
      const attacks = PLUGIN_ATTACKS[pfId];
      // Each attack produces exactly 1 result; plugins with no attacks get 1 synthetic result
      total += attacks ? attacks.length : 1;
    } else {
      // Docker workers (garak, pyrit, deepteam): conservative estimate of 1 per plugin
      total += 1;
    }
  }
  return total;
}

// ─── Result row type ──────────────────────────────────────────────────────────
type ResultCallback = (r: {
  tool: "promptfoo" | "garak" | "pyrit" | "deepteam";
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  testName: string;
  owaspCategory?: string | null;
  prompt?: string | null;
  response?: string | null;
  passed: boolean;
  evidence: string; // JSON string
}) => Promise<void>;

// ─── Orchestrator ─────────────────────────────────────────────────────────────
export class ScanOrchestrator {
  private runner = new DockerRunner();

  /** In-flight scans in THIS worker process → their AbortController. */
  private activeScans = new Map<string, AbortController>();

  /** Abort every in-flight scan (used on worker shutdown to kill containers). */
  abortAll(): void {
    for (const [scanId, controller] of this.activeScans) {
      logger.info(`[Scanner] Aborting in-flight scan ${scanId} on shutdown`);
      controller.abort();
    }
  }

  /**
   * Cancel a specific scan if it's running in THIS process — aborts its
   * controller so the current tool's container is killed immediately. A no-op
   * for scans owned by another replica (they receive the same signal and act on
   * their own copy). Delivered promptly via the Redis cancel channel.
   */
  cancel(scanId: string): void {
    const controller = this.activeScans.get(scanId);
    if (controller && !controller.signal.aborted) {
      logger.info(`[Scanner] Cancel signal received for in-flight scan ${scanId}`);
      controller.abort();
    }
  }

  /** Read the current persisted status (used to detect out-of-process cancel). */
  private async isCancelled(scanId: string): Promise<boolean> {
    const row = await db
      .select({ status: scans.status })
      .from(scans)
      .where(eq(scans.id, scanId))
      .get();
    return row?.status === "cancelled";
  }

  /**
   * True if the scan should stop — either aborted in this process (cheap sync
   * signal check) or cancelled out-of-process (falls back to a DB read only
   * when the signal hasn't already fired).
   */
  private async isStopRequested(scanId: string, abort: AbortController): Promise<boolean> {
    return abort.signal.aborted || (await this.isCancelled(scanId));
  }

  async run(scanId: string, onProgress?: (progress: number) => void): Promise<void> {
    logger.info(`[Scanner] Starting scan ${scanId}`);

    const abort = new AbortController();
    this.activeScans.set(scanId, abort);

    await db
      .update(scans)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(scans.id, scanId));

    try {
      const scan = await db.select().from(scans).where(eq(scans.id, scanId)).get();
      if (!scan) throw new Error(`Scan ${scanId} not found`);

      // Idempotent (re)start: clear any results from a previous attempt so a
      // BullMQ retry doesn't leave orphaned rows and double-count findings.
      await db.delete(scanResults).where(eq(scanResults.scanId, scanId));
      await db
        .update(scans)
        .set({ passedTests: 0, failedTests: 0, progress: 0, errorMessage: null })
        .where(eq(scans.id, scanId));

      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, scan.projectId))
        .get();
      if (!project) throw new Error(`Project ${scan.projectId} not found`);

      const pluginIds: string[] = safeJsonParse(scan.plugins, []);
      const plugins = resolvePlugins(pluginIds);
      if (plugins.length === 0) throw new Error("No valid plugins found for this scan");

      // Group plugins by tool
      const byTool = plugins.reduce<Record<PluginTool, string[]>>(
        (acc, plugin) => {
          if (!acc[plugin.tool]) acc[plugin.tool] = [];
          acc[plugin.tool].push(plugin.id);
          return acc;
        },
        {} as Record<PluginTool, string[]>
      );

      const tools = Object.keys(byTool) as PluginTool[];
      const providerConfig = safeJsonParse<Record<string, unknown>>(project.providerConfig, {});

      let completedTools = 0;
      let passedTests = 0;
      let failedTests = 0;

      // Pre-calculate expected test count so the progress bar works correctly
      const totalExpected = estimateTotalTests(pluginIds);
      if (totalExpected > 0) {
        await db
          .update(scans)
          .set({ totalTests: totalExpected })
          .where(eq(scans.id, scanId));
      }

      // ── Endpoint Auto-Bridge: start gateway for localhost targets ────────
      const isLocal = isLocalhostUrl(project.targetUrl);
      let gatewayPort: number | undefined;
      if (isLocal) {
        try {
          gatewayPort = await gateway.start(project.targetUrl);
          gateway.acquire();
          logger.info(
            `[Scanner] Endpoint gateway active on port ${gatewayPort} for ${project.targetUrl}`
          );
        } catch (err) {
          logger.warn(
            `[Scanner] Could not start endpoint gateway: ${errorMessage(err)}. ` +
              `Docker workers may not be able to reach localhost targets.`
          );
        }
      }

      // Flush the scan's running counters/progress to the DB. Batched (see
      // below) so a large scan doesn't do one full-row UPDATE per finding
      // against the WAL SQLite file the API also reads.
      const FLUSH_EVERY = 20;
      let sinceFlush = 0;
      const flushProgress = async (): Promise<void> => {
        sinceFlush = 0;
        const completedCount = passedTests + failedTests;
        const effectiveTotal = Math.max(totalExpected, completedCount);
        const pct = Math.min(Math.round((completedCount / effectiveTotal) * 100), 99);
        await db
          .update(scans)
          .set({ totalTests: effectiveTotal, passedTests, failedTests, progress: pct })
          .where(eq(scans.id, scanId));
      };

      // Shared result persister — used by all tools
      const persistResult: ResultCallback = async (r) => {
        await db.insert(scanResults).values({
          id: uuid(),
          scanId,
          tool: r.tool,
          category: r.category,
          severity: r.severity,
          testName: r.testName,
          owaspCategory: r.owaspCategory ?? null,
          prompt: r.prompt ?? null,
          response: r.response ?? null,
          passed: r.passed,
          evidence: r.evidence,
          createdAt: new Date(),
        });
        if (r.passed) passedTests++;
        else failedTests++;

        if (++sinceFlush >= FLUSH_EVERY) await flushProgress();
      };

      try {
      for (const tool of tools) {
        // Stop between tools if the scan was cancelled (out-of-process cancel
        // flips the DB status; abort kills any container mid-tool).
        if (await this.isStopRequested(scanId, abort)) {
          abort.abort();
          logger.info(`[Scanner] Scan ${scanId} cancelled — stopping before ${tool}`);
          break;
        }

        const toolPlugins = byTool[tool];
        logger.info(`[Scanner] Running ${tool} with ${toolPlugins.length} plugins`);

        const config = {
          targetUrl: project.targetUrl,
          model: (providerConfig.model as string) || "default",
          providerType: project.providerType,
          providerConfig,
          plugins: toolPlugins,
          tool,
          ownerUserId: scan.userId,
          ...(gatewayPort != null ? { gatewayPort } : {}),
        };

        if (tool === "promptfoo") {
          await this.runPromptfoo(scanId, config, persistResult, abort.signal);
        } else {
          try {
            await this.runner.run(tool, config, async (result) => {
              await persistResult({
                tool,
                category: result.category || tool,
                severity: result.severity || "medium",
                testName: result.testName,
                owaspCategory: result.owaspCategory ?? null,
                prompt: result.prompt ?? null,
                response: result.response ?? null,
                passed: result.passed,
                evidence: JSON.stringify(result.evidence || {}),
              });
            }, abort.signal);
          } catch (err) {
            // Docker not available or image not built — emit an error record per plugin
            const errMsg = errorMessage(err);
            logger.error(`[Scanner] ${tool} worker unavailable: ${errMsg}`);
            for (const pluginId of toolPlugins) {
              await persistResult({
                tool,
                category: tool,
                severity: "info",
                testName: `[${tool}] ${pluginId} (unavailable)`,
                owaspCategory: null,
                prompt: null,
                response: null,
                passed: false,
                evidence: JSON.stringify({
                  errored: true,
                  reason: `Docker worker unavailable: ${errMsg}`,
                  pluginId,
                }),
              });
            }
          }
        }

        // Flush any results buffered since the last batch so the row is current
        // at each tool boundary.
        await flushProgress();
        completedTools++;
        onProgress?.(Math.round((completedTools / tools.length) * 100));
      }
      } finally {
        // ── Release the endpoint gateway when all tools are done ──────────
        if (isLocal && gatewayPort != null) {
          gateway.release();
        }
      }

      const finalTotal = passedTests + failedTests;

      // If the scan was cancelled (in- or out-of-process), record the partial
      // results but do NOT overwrite the status back to "completed".
      if (await this.isStopRequested(scanId, abort)) {
        await db
          .update(scans)
          .set({
            status: "cancelled",
            completedAt: new Date(),
            totalTests: finalTotal,
            passedTests,
            failedTests,
          })
          .where(eq(scans.id, scanId));
        logger.info(`[Scanner] Scan ${scanId} cancelled — ${finalTotal} partial results kept`);
        return;
      }

      await db
        .update(scans)
        .set({
          status: "completed",
          completedAt: new Date(),
          totalTests: finalTotal,
          passedTests,
          failedTests,
          progress: 100,
        })
        .where(eq(scans.id, scanId));

      logger.info(
        `[Scanner] Scan ${scanId} completed — ${finalTotal} tests, ${failedTests} findings`
      );
    } catch (err) {
      // A cancellation can surface as a thrown error (e.g. an aborted fetch);
      // don't mislabel it as "failed".
      if (await this.isStopRequested(scanId, abort)) {
        await db
          .update(scans)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(eq(scans.id, scanId));
        logger.info(`[Scanner] Scan ${scanId} cancelled during execution`);
        return;
      }
      const message = errorMessage(err);
      logger.error(`[Scanner] Scan ${scanId} failed: ${message}`);
      await db
        .update(scans)
        .set({ status: "failed", errorMessage: message, completedAt: new Date() })
        .where(eq(scans.id, scanId));
      throw err;
    } finally {
      this.activeScans.delete(scanId);
    }
  }

  // ─── Promptfoo runner ──────────────────────────────────────────────────────

  private async runPromptfoo(
    _scanId: string,
    config: {
      plugins: string[];
      targetUrl: string;
      providerType: string;
      providerConfig: Record<string, unknown>;
      model?: string;
      ownerUserId?: string;
    },
    onResult: ResultCallback,
    signal?: AbortSignal
  ): Promise<void> {
    // Attempt dynamic import of promptfoo's evaluate API
    let pfEvaluate: ((cfg: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<any>) | null = null;

    try {
      const pf = await import("promptfoo");
      const candidate = (pf as any).evaluate ?? (pf as any).default?.evaluate;
      if (typeof candidate === "function") pfEvaluate = candidate;
    } catch {
      // promptfoo not installed
    }

    if (!pfEvaluate) {
      logger.warn("[Scanner][promptfoo] Package not available — results will show as errored");
      return this.runPromptfooUnavailable(config, onResult, signal);
    }

    // ── Ollama: try direct call first, fall back to browser relay ──────────
    // When running on the same machine as Ollama, call it directly (fastest).
    // When hosted remotely, the browser relay forwards via the user's browser.
    if (config.providerType === "ollama") {
      const ollamaUrl = resolveOllamaUrl(config.targetUrl);
      const directReachable = await this.probeOllama(ollamaUrl);

      if (directReachable) {
        logger.info(`[Scanner][promptfoo] Ollama reachable directly at ${ollamaUrl} — skipping browser relay`);
        return this.runOllamaAttacksDirect(config, onResult, signal);
      }

      logger.info(`[Scanner][promptfoo] Ollama not directly reachable — using browser relay`);
      return this.runOllamaAttacksViaRelay(config, onResult, signal);
    }

    // ── Custom / OpenAI-compatible: call endpoint directly ────────────────
    // Bypass promptfoo's HTTP provider which uses a single hardcoded
    // transformResponse path (json.choices[0].message.content) and silently
    // returns undefined when the response structure differs.  Direct calls
    // give us multiple fallback extraction paths and proper error handling.
    if (config.providerType === "custom" || !["openai", "anthropic", "azure-openai"].includes(config.providerType)) {
      return this.runCustomEndpointAttacksDirect(config, onResult, signal);
    }

    const provider = this.buildProvider(config);

    for (const pluginId of config.plugins) {
      if (signal?.aborted) {
        logger.info("[Scanner][promptfoo] Cancelled — stopping evaluation");
        return;
      }
      const pfId = PLUGIN_DISPLAY[pluginId] ?? pluginId.replace("promptfoo:", "");
      const attacks = PLUGIN_ATTACKS[pfId];

      if (!attacks || attacks.length === 0) {
        // No attack library entry — emit a synthetic pass so the plugin still appears in results
        await onResult({
          tool: "promptfoo",
          category: pfId,
          severity: this.getSeverity(pluginId),
          testName: `[promptfoo] ${pfId}`,
          owaspCategory: this.getOwasp(pluginId),
          prompt: `(no attack tests defined for ${pfId})`,
          response: null,
          passed: true,
          evidence: JSON.stringify({ note: "no-attack-library", pluginId }),
        });
        continue;
      }

      for (const attack of attacks) {
        try {
          const summary = await pfEvaluate(
            {
              providers: [provider],
              prompts: [attack.prompt],
              tests: [
                {
                  // Pass (safe) when the response does NOT match the fail pattern
                  assert: [
                    {
                      type: "javascript",
                      value: `!String(output).match(${attack.failPattern.toString()})`,
                    },
                  ],
                },
              ],
              sharing: false,
            },
            { showProgressBar: false, maxConcurrency: 1 }
          );

          for (const r of summary?.results ?? []) {
            const responseText = r.response?.output != null ? String(r.response.output) : r.error ?? null;

            // Detect empty/null responses — these indicate a provider
            // communication failure, not a genuine "pass"
            const isEmpty = responseText == null || responseText.trim() === "" || responseText === "undefined" || responseText === "null";
            if (isEmpty) {
              logger.warn(
                `[Scanner][promptfoo] Empty response for plugin ${pfId} — ` +
                `recording as error (raw output: ${JSON.stringify(r.response?.output)})`
              );
            }

            const passed = !isEmpty && r.success === true && !r.error;

            await onResult({
              tool: "promptfoo",
              category: pfId,
              severity: this.getSeverity(pluginId),
              testName: `[promptfoo] ${pfId}`,
              owaspCategory: this.getOwasp(pluginId),
              prompt: attack.prompt,
              response: isEmpty ? null : responseText,
              passed,
              evidence: JSON.stringify({
                pluginId,
                failPattern: attack.failPattern.toString(),
                latencyMs: r.latencyMs ?? 0,
                gradingResult: r.gradingResult ?? null,
                error: isEmpty
                  ? `Empty response from provider (raw: ${JSON.stringify(r.response?.output)})`
                  : r.error ?? null,
              }),
            });
          }
        } catch (err) {
          logger.error(`[Scanner][promptfoo] Error running attack for plugin ${pfId}: ${err}`);
          // Record as a failed test so the issue surfaces in results
          await onResult({
            tool: "promptfoo",
            category: pfId,
            severity: this.getSeverity(pluginId),
            testName: `[promptfoo] ${pfId}`,
            owaspCategory: this.getOwasp(pluginId),
            prompt: attack.prompt,
            response: null,
            passed: false,
            evidence: JSON.stringify({ error: String(err), pluginId }),
          });
        }
      }
    }
  }

  /** Quick connectivity probe — returns true if Ollama responds within 5 s. */
  private async probeOllama(ollamaUrl: string): Promise<boolean> {
    // In Docker, localhost won't reach the host — resolve to host.docker.internal
    const resolved = resolveForHost(ollamaUrl);
    try {
      const resp = await fetch(`${resolved}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Run promptfoo plugin attacks against Ollama directly (no browser relay).
   * Used when the server process can reach Ollama on its own — the fastest path.
   */
  private async runOllamaAttacksDirect(
    config: {
      plugins: string[];
      targetUrl: string;
      providerConfig: Record<string, unknown>;
      model?: string;
    },
    onResult: ResultCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const resolvedOllamaUrl = resolveOllamaUrl(config.targetUrl);
    assertUrlNotBlocked(resolvedOllamaUrl);
    const ollamaUrl = resolveForHost(resolvedOllamaUrl);
    const model =
      (config.providerConfig.model as string | undefined) ?? config.model ?? "llama3";

    logger.info(`[Scanner][ollama-direct] Running attacks directly → ${ollamaUrl}`);

    await this.runAttackLoop(config.plugins, "[Scanner][ollama-direct]", onResult, async (attack) => {
      const resp = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: attack.prompt }],
          stream: false,
        }),
        signal: AbortSignal.timeout(getOllamaTimeoutMs()),
      });
      if (!resp.ok) throw new Error(`Ollama returned HTTP ${resp.status}`);
      const data = (await resp.json()) as { message?: { content?: string } };
      return { responseText: data.message?.content ?? "", extraEvidence: { direct: true } };
    }, signal);
  }

  /**
   * Run all promptfoo plugin attacks for an Ollama target via the browser relay.
   *
   * The worker enqueues each prompt into the shared Redis relay queue (scoped to
   * the scan owner); the user's browser picks it up, calls their local Ollama,
   * and posts the response back. We then evaluate the response against the
   * plugin's failPattern ourselves. Enqueuing directly into Redis means the
   * worker no longer HTTP-POSTs to its own app process with a minted token.
   */
  private async runOllamaAttacksViaRelay(
    config: {
      plugins: string[];
      targetUrl: string;
      providerConfig: Record<string, unknown>;
      model?: string;
      ownerUserId?: string;
    },
    onResult: ResultCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const ollamaUrl = resolveForHost(resolveOllamaUrl(config.targetUrl));
    const model =
      (config.providerConfig.model as string | undefined) ?? config.model ?? "llama3";

    if (!config.ownerUserId) {
      throw new Error("Cannot run an Ollama browser-relay scan without a scan owner.");
    }
    const ownerUserId = config.ownerUserId;
    const { queueRelayRequest } = await import("./ollamaRelay.js");

    logger.info(`[Scanner][ollama-relay] Running attacks via browser relay → ${ollamaUrl}`);

    await this.runAttackLoop(config.plugins, "[Scanner][ollama-relay]", onResult, async (attack) => {
      const data = (await queueRelayRequest(
        ownerUserId,
        ollamaUrl,
        "/api/chat",
        { model, messages: [{ role: "user", content: attack.prompt }], stream: false },
        getOllamaTimeoutMs(),
        signal
      )) as { message?: { content?: string } };
      return { responseText: data.message?.content ?? "", extraEvidence: { relay: true } };
    }, signal);
  }

  /**
   * Run promptfoo plugin attacks directly against a custom/OpenAI-compatible endpoint.
   *
   * Instead of relying on promptfoo's HTTP provider (which uses a single
   * hardcoded `transformResponse` path that silently returns undefined on
   * non-standard response shapes), we call the endpoint directly and extract
   * the response with multiple fallback paths — matching the logic in
   * `aiProvider.ts` that already works for remediation and settings tests.
   */
  private async runCustomEndpointAttacksDirect(
    config: {
      plugins: string[];
      targetUrl: string;
      providerConfig: Record<string, unknown>;
      model?: string;
    },
    onResult: ResultCallback,
    signal?: AbortSignal
  ): Promise<void> {
    assertUrlNotBlocked(config.targetUrl);
    const targetUrl = resolveForHost(config.targetUrl);
    const model =
      (config.providerConfig.model as string | undefined) ?? config.model ?? "gpt-4o-mini";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.providerConfig.headers as Record<string, string> | undefined),
    };
    const apiKey = config.providerConfig.apiKey as string | undefined;
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    logger.info(`[Scanner][custom-direct] Running attacks directly → ${targetUrl}`);

    await this.runAttackLoop(config.plugins, "[Scanner][custom-direct]", onResult, async (attack) => {
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: attack.prompt }],
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`Custom endpoint returned HTTP ${resp.status}: ${errBody}`);
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string }; text?: string }[];
        message?: { content?: string };
        response?: string;
        output?: string;
      };

      const responseText =
        data.choices?.[0]?.message?.content ??
        data.choices?.[0]?.text ??
        data.message?.content ??
        data.response ??
        data.output ??
        "";

      if (!responseText) {
        logger.warn(
          `[Scanner][custom-direct] Empty response — structure: ${JSON.stringify(data).slice(0, 300)}`
        );
      }

      return {
        responseText,
        extraEvidence: {
          direct: true,
          ...(responseText ? {} : { emptyResponse: true, rawStructure: JSON.stringify(data).slice(0, 300) }),
        },
      };
    }, signal);
  }

  /** Emits error results for each plugin when the promptfoo package is not installed. */
  private async runPromptfooUnavailable(
    config: { plugins: string[] },
    onResult: ResultCallback,
    signal?: AbortSignal
  ): Promise<void> {
    for (const pluginId of config.plugins) {
      if (signal?.aborted) return;
      const pfId = pluginId.replace("promptfoo:", "");
      await onResult({
        tool: "promptfoo",
        category: pfId,
        severity: this.getSeverity(pluginId),
        testName: `[promptfoo] ${pfId} (unavailable)`,
        owaspCategory: this.getOwasp(pluginId),
        prompt: null,
        response: null,
        passed: false,
        evidence: JSON.stringify({
          errored: true,
          reason: "promptfoo package not installed — run: npm install promptfoo",
          pluginId,
        }),
      });
    }
  }

  // ─── Provider config builder ───────────────────────────────────────────────

  private buildProvider(config: {
    targetUrl: string;
    providerType: string;
    providerConfig: Record<string, unknown>;
    model?: string;
  }): Record<string, unknown> {
    const { providerType, providerConfig, targetUrl, model } = config;
    const m = (providerConfig.model as string | undefined) ?? model ?? "gpt-4o-mini";

    switch (providerType) {
      case "openai":
        return {
          id: `openai:chat:${m}`,
          config: { apiKey: providerConfig.apiKey },
        };

      case "anthropic":
        return {
          id: `anthropic:messages:${m}`,
          config: { apiKey: providerConfig.apiKey },
        };

      case "ollama":
        return {
          id: `ollama:chat:${m}`,
          config: {
            apiBaseUrl: resolveForHost(
              process.env.OLLAMA_URL || targetUrl || "http://localhost:11434"
            ),
          },
        };

      case "azure-openai":
        return {
          id: `azureopenai:chat:${(providerConfig.deployment as string | undefined) ?? m}`,
          config: {
            apiKey: providerConfig.apiKey,
            apiHost: providerConfig.resourceName
              ? `${providerConfig.resourceName}.openai.azure.com`
              : undefined,
          },
        };

      // custom-http or unknown
      default:
        return {
          id: "http",
          config: {
            url: targetUrl,
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(providerConfig.headers as object | undefined),
            },
            body: {
              model: m,
              messages: [{ role: "user", content: "{{prompt}}" }],
            },
            transformResponse: "json.choices[0].message.content",
          },
        };
    }
  }

  // ─── Shared attack loop ────────────────────────────────────────────────────

  /**
   * Iterate over plugins → attacks and call `sendAttack` for each.
   * Handles the no-attacks placeholder, result emission, and error recording
   * in one place so the caller only provides the HTTP call logic.
   */
  private async runAttackLoop(
    plugins: string[],
    logPrefix: string,
    onResult: ResultCallback,
    sendAttack: (attack: { prompt: string; failPattern: RegExp }) => Promise<{
      responseText: string;
      extraEvidence?: Record<string, unknown>;
    }>,
    signal?: AbortSignal
  ): Promise<void> {
    for (const pluginId of plugins) {
      if (signal?.aborted) {
        logger.info(`${logPrefix} Cancelled — stopping attack loop`);
        return;
      }
      const pfId = PLUGIN_DISPLAY[pluginId] ?? pluginId.replace("promptfoo:", "");
      const attacks = PLUGIN_ATTACKS[pfId];

      if (!attacks || attacks.length === 0) {
        await onResult({
          tool: "promptfoo",
          category: pfId,
          severity: this.getSeverity(pluginId),
          testName: `[promptfoo] ${pfId}`,
          owaspCategory: this.getOwasp(pluginId),
          prompt: `(no attack tests defined for ${pfId})`,
          response: null,
          passed: true,
          evidence: JSON.stringify({ note: "no-attack-library", pluginId }),
        });
        continue;
      }

      for (const attack of attacks) {
        const start = Date.now();
        try {
          const { responseText, extraEvidence } = await sendAttack(attack);
          const passed = responseText ? !attack.failPattern.test(responseText) : false;
          const latencyMs = Date.now() - start;

          await onResult({
            tool: "promptfoo",
            category: pfId,
            severity: this.getSeverity(pluginId),
            testName: `[promptfoo] ${pfId}`,
            owaspCategory: this.getOwasp(pluginId),
            prompt: attack.prompt,
            response: responseText || null,
            passed,
            evidence: JSON.stringify({
              pluginId,
              failPattern: attack.failPattern.toString(),
              latencyMs,
              ...extraEvidence,
            }),
          });
        } catch (err) {
          logger.error(`${logPrefix} Error for plugin ${pfId}: ${err}`);
          await onResult({
            tool: "promptfoo",
            category: pfId,
            severity: this.getSeverity(pluginId),
            testName: `[promptfoo] ${pfId}`,
            owaspCategory: this.getOwasp(pluginId),
            prompt: attack.prompt,
            response: null,
            passed: false,
            evidence: JSON.stringify({ error: String(err), pluginId }),
          });
        }
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private getSeverity(pluginId: string): "critical" | "high" | "medium" | "low" | "info" {
    // Prefer the authoritative severity from the plugin catalog.
    const plugin = getPluginById(pluginId);
    if (plugin) return plugin.severity;

    // Fallback heuristic for IDs not present in the catalog.
    if (
      pluginId.includes("injection") ||
      pluginId.includes("pii") ||
      pluginId.includes("harmful")
    )
      return "critical";
    if (pluginId.includes("jailbreak") || pluginId.includes("system-prompt")) return "high";
    return "medium";
  }

  private getOwasp(pluginId: string): string | null {
    // The catalog carries the correct OWASP category for all 60 plugins; the
    // previous 8-entry substring map left almost every finding uncategorised.
    const plugin = getPluginById(pluginId);
    if (plugin) return plugin.owaspCategory ?? null;

    const map: Record<string, string> = {
      "promptfoo:prompt-injection": "LLM01",
      "promptfoo:indirect-prompt-injection": "LLM01",
      "promptfoo:jailbreak": "LLM01",
      "promptfoo:pii-extraction": "LLM02",
      "promptfoo:rbac-bypass": "LLM02",
      "promptfoo:harmful-content": "LLM06",
      "promptfoo:system-prompt-leak": "LLM07",
      "promptfoo:overreliance": "LLM09",
    };
    return map[pluginId] ?? null;
  }
}
