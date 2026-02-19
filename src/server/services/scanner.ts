import { v4 as uuid } from "uuid";
import { db } from "../../db/index.js";
import { scans, scanResults, projects } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { resolvePlugins, type PluginTool } from "../config/pluginCatalog.js";
import { DockerRunner } from "./dockerRunner.js";
import { logger } from "../utils/logger.js";

export class ScanOrchestrator {
  private runner = new DockerRunner();

  async run(
    scanId: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    logger.info(`[Scanner] Starting scan ${scanId}`);

    // Mark scan as running
    await db
      .update(scans)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(scans.id, scanId));

    try {
      // Load scan + project details
      const scan = await db
        .select()
        .from(scans)
        .where(eq(scans.id, scanId))
        .get();

      if (!scan) throw new Error(`Scan ${scanId} not found`);

      const project = await db
        .select()
        .from(projects)
        .where(eq(projects.id, scan.projectId))
        .get();

      if (!project) throw new Error(`Project ${scan.projectId} not found`);

      const pluginIds: string[] = JSON.parse(scan.plugins);
      const plugins = resolvePlugins(pluginIds);

      if (plugins.length === 0) {
        throw new Error("No valid plugins found for this scan");
      }

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
      const providerConfig = JSON.parse(project.providerConfig) as Record<string, unknown>;

      let completedTools = 0;
      let totalTests = 0;
      let passedTests = 0;
      let failedTests = 0;

      // Run each tool sequentially (can be parallelized in v2)
      for (const tool of tools) {
        const toolPlugins = byTool[tool];
        logger.info(`[Scanner] Running ${tool} with ${toolPlugins.length} plugins`);

        const config = {
          targetUrl: project.targetUrl,
          model: (providerConfig.model as string) || "default",
          providerType: project.providerType,
          providerConfig,
          plugins: toolPlugins,
          tool,
        };

        // Promptfoo runs natively (not via Docker) — mock for now
        let toolResults;
        if (tool === "promptfoo") {
          toolResults = await this.runPromptfoo(scanId, config);
        } else {
          toolResults = await this.runner.run(tool, config, async (result) => {
            // Stream result to DB as it arrives
            await db.insert(scanResults).values({
              id: uuid(),
              scanId,
              tool,
              category: result.category || tool,
              severity: result.severity || "medium",
              testName: result.testName,
              owaspCategory: result.owaspCategory || null,
              prompt: result.prompt || null,
              response: result.response || null,
              passed: result.passed,
              evidence: JSON.stringify(result.evidence || {}),
              createdAt: new Date(),
            });

            totalTests++;
            if (result.passed) passedTests++;
            else failedTests++;

            // Update scan counters
            await db
              .update(scans)
              .set({ totalTests, passedTests, failedTests })
              .where(eq(scans.id, scanId));
          });
        }

        completedTools++;
        onProgress?.(Math.round((completedTools / tools.length) * 100));
      }

      // Mark completed
      await db
        .update(scans)
        .set({
          status: "completed",
          completedAt: new Date(),
          totalTests,
          passedTests,
          failedTests,
        })
        .where(eq(scans.id, scanId));

      logger.info(
        `[Scanner] Scan ${scanId} completed. ${totalTests} tests, ${failedTests} failures.`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Scanner] Scan ${scanId} failed: ${message}`);

      await db
        .update(scans)
        .set({
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
        })
        .where(eq(scans.id, scanId));

      throw err;
    }
  }

  /**
   * Promptfoo runs natively in Node.js — this generates synthetic test results
   * that simulate what promptfoo would produce. In production, integrate with
   * promptfoo's Node.js API (promptfoo.run()) here.
   */
  private async runPromptfoo(
    scanId: string,
    config: { plugins: string[]; targetUrl: string; providerType: string }
  ): Promise<void> {
    const syntheticResults = config.plugins.map((pluginId) => {
      const pluginName = pluginId.replace("promptfoo:", "");
      const passed = Math.random() > 0.4; // 40% failure rate for demo
      return {
        tool: "promptfoo" as const,
        category: pluginName,
        severity: this.getSeverityForPlugin(pluginId),
        testName: `[promptfoo] ${pluginName}`,
        owaspCategory: this.getOwaspForPlugin(pluginId),
        prompt: `Test prompt for ${pluginName}`,
        response: passed
          ? "I cannot help with that request."
          : `Here's how to ${pluginName.replace(/-/g, " ")}...`,
        passed,
        evidence: { pluginId, targetUrl: config.targetUrl, timestamp: new Date().toISOString() },
      };
    });

    for (const result of syntheticResults) {
      await db.insert(scanResults).values({
        id: uuid(),
        scanId,
        tool: result.tool,
        category: result.category,
        severity: result.severity,
        testName: result.testName,
        owaspCategory: result.owaspCategory || null,
        prompt: result.prompt,
        response: result.response,
        passed: result.passed,
        evidence: JSON.stringify(result.evidence),
        createdAt: new Date(),
      });
    }
  }

  private getSeverityForPlugin(pluginId: string): "critical" | "high" | "medium" | "low" | "info" {
    if (pluginId.includes("injection") || pluginId.includes("pii") || pluginId.includes("harmful")) {
      return "critical";
    }
    if (pluginId.includes("jailbreak") || pluginId.includes("system-prompt")) return "high";
    return "medium";
  }

  private getOwaspForPlugin(pluginId: string): string | undefined {
    const owaspMap: Record<string, string> = {
      "promptfoo:prompt-injection": "LLM01",
      "promptfoo:indirect-prompt-injection": "LLM01",
      "promptfoo:jailbreak": "LLM01",
      "promptfoo:pii-extraction": "LLM02",
      "promptfoo:rbac-bypass": "LLM02",
      "promptfoo:harmful-content": "LLM06",
      "promptfoo:system-prompt-leak": "LLM07",
      "promptfoo:overreliance": "LLM09",
    };
    return owaspMap[pluginId];
  }
}
