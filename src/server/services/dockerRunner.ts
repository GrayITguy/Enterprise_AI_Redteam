import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import { logger } from "../utils/logger.js";
import { isLocalhostUrl } from "../utils/helpers.js";

export interface DockerScanResult {
  testName: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  owaspCategory?: string | null;
  prompt?: string | null;
  response?: string | null;
  passed: boolean;
  evidence: Record<string, unknown>;
}

export interface DockerRunConfig {
  targetUrl: string;
  model?: string;
  providerType: string;
  providerConfig: Record<string, unknown>;
  plugins: string[];
  tool: string;
  gatewayPort?: number;
  /** Independent evaluator LLM for workers that need one (e.g. deepteam). */
  evalProvider?: { type: string; endpoint: string; apiKey: string; model: string };
}

/** Convert camelCase config keys to snake_case for Python workers. */
function toSnakeConfig(config: DockerRunConfig): Record<string, unknown> {
  const { gatewayPort, evalProvider, ...rest } = config;
  let targetUrl = rest.targetUrl;

  // When a gateway port is provided, rewrite localhost URLs so the Docker
  // container reaches the host-side gateway via host.docker.internal.
  if (gatewayPort && isLocalhostUrl(targetUrl)) {
    const parsed = new URL(targetUrl);
    targetUrl = `http://host.docker.internal:${gatewayPort}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    logger.info(`[DockerRunner] Rewrote target URL → ${targetUrl}`);
  }

  const snake: Record<string, unknown> = {
    target_url: targetUrl,
    model: rest.model,
    provider_type: rest.providerType,
    provider_config: rest.providerConfig,
    plugins: rest.plugins,
    tool: rest.tool,
  };

  // Pass the evaluator provider through (deepteam). Rewrite a localhost eval
  // endpoint so the container reaches the host LLM via host.docker.internal.
  if (evalProvider) {
    let endpoint = evalProvider.endpoint;
    if (endpoint && isLocalhostUrl(endpoint)) {
      const parsed = new URL(endpoint);
      endpoint = `http://host.docker.internal:${parsed.port || 80}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    }
    snake.eval_provider = {
      type: evalProvider.type,
      endpoint,
      api_key: evalProvider.apiKey,
      model: evalProvider.model,
    };
  }

  return snake;
}

/**
 * Normalize a raw JSON line emitted by a Python worker into a DockerScanResult.
 *
 * Workers emit snake_case keys (`test_name`, `owasp_category`, …) but the rest
 * of the backend consumes camelCase.  Without this mapping the camelCase fields
 * are `undefined` at runtime, and since `scan_results.test_name` is NOT NULL
 * every Garak/PyRIT/DeepTeam insert throws and the findings are silently lost.
 *
 * Returns `null` for protocol/error lines (e.g. `{"error": "..."}`) that are not
 * scan results — the caller logs and skips those.
 */
export function normalizeWorkerResult(raw: Record<string, unknown>): DockerScanResult | null {
  // Config-parse failures and startup banners are emitted as bare {"error": ...}
  // or {"startup": ...} objects — they carry no test_name and are not findings.
  const testName = (raw.testName ?? raw.test_name) as string | undefined;
  if (!testName) return null;

  const severityRaw = (raw.severity as string | undefined) ?? "medium";
  const allowed = ["critical", "high", "medium", "low", "info"] as const;
  const severity = (allowed as readonly string[]).includes(severityRaw)
    ? (severityRaw as DockerScanResult["severity"])
    : "medium";

  const evidence = raw.evidence;
  return {
    testName,
    category: (raw.category as string | undefined) ?? "unknown",
    severity,
    owaspCategory: (raw.owaspCategory ?? raw.owasp_category ?? null) as string | null,
    prompt: (raw.prompt ?? null) as string | null,
    response: (raw.response ?? null) as string | null,
    passed: raw.passed === true,
    evidence:
      evidence && typeof evidence === "object" ? (evidence as Record<string, unknown>) : {},
  };
}

export class DockerRunner {
  private getImage(tool: string): string {
    const images: Record<string, string> = {
      garak: process.env.GARAK_IMAGE ?? "eart-garak:latest",
      pyrit: process.env.PYRIT_IMAGE ?? "eart-pyrit:latest",
      deepteam: process.env.DEEPTEAM_IMAGE ?? "eart-deepteam:latest",
    };
    return images[tool] ?? `eart-${tool}:latest`;
  }

  async run(
    tool: string,
    config: DockerRunConfig,
    onResult?: (result: DockerScanResult) => Promise<void>,
    signal?: AbortSignal
  ): Promise<DockerScanResult[]> {
    const image = this.getImage(tool);
    // Convert to snake_case for Python workers and apply gateway URL rewriting
    const snakeConfig = toSnakeConfig(config);
    const configJson = JSON.stringify(snakeConfig);
    const results: DockerScanResult[] = [];

    // A stable container name so the container itself (not just the docker CLI
    // process) can be killed on timeout or cancellation.
    const containerName = `eart-wkr-${tool}-${uuid().slice(0, 8)}`;

    logger.info(`[DockerRunner] Starting ${tool} worker (image: ${image}, container: ${containerName})`);

    if (signal?.aborted) {
      logger.info(`[DockerRunner] ${tool} worker aborted before start`);
      return results;
    }

    return new Promise((resolve, reject) => {
      const args = [
        "run",
        "--rm",
        "-i",
        "--name",
        containerName,
        "--memory=2g",
        "--cpus=1",
        "--pids-limit=512",
        "--security-opt=no-new-privileges",
        // Use --add-host instead of --network=host for cross-platform support.
        // --network=host only works on Linux; --add-host works on Linux,
        // macOS, and Windows Docker Desktop.
        "--add-host=host.docker.internal:host-gateway",
        image,
      ];

      const child = spawn("docker", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Kill the running container (not just the docker CLI process) so the
      // Python worker actually stops hammering the target.
      const killContainer = (reason: string): void => {
        logger.warn(`[DockerRunner] Killing ${tool} container ${containerName}: ${reason}`);
        try {
          spawn("docker", ["kill", containerName], { stdio: "ignore" }).on("error", () => {
            /* docker missing — child.error will fire separately */
          });
        } catch {
          /* ignore */
        }
      };

      // Serialize onResult calls into a single chain so DB writes don't race and
      // so any rejection is surfaced (previously results were fire-and-forget).
      let persistChain: Promise<void> = Promise.resolve();
      const handleRaw = (rawLine: string): void => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawLine) as Record<string, unknown>;
        } catch {
          logger.warn(`[DockerRunner] Failed to parse JSONL line: ${rawLine.slice(0, 100)}`);
          return;
        }
        const normalized = normalizeWorkerResult(parsed);
        if (!normalized) {
          // Protocol line (error / startup banner) — surface it, don't persist.
          if (parsed.error) {
            logger.error(`[DockerRunner] ${tool} worker error line: ${String(parsed.error).slice(0, 300)}`);
          }
          return;
        }
        results.push(normalized);
        if (onResult) {
          persistChain = persistChain.then(() =>
            onResult(normalized).catch((err) => {
              logger.error(`[DockerRunner] onResult callback error: ${err.message}`);
            })
          );
        }
      };

      // Send config as JSON on stdin. Guard against EPIPE when docker is missing.
      child.stdin.on("error", (err) => {
        logger.warn(`[DockerRunner] stdin error for ${tool}: ${err.message}`);
      });
      child.stdin.write(configJson + "\n");
      child.stdin.end();

      let buffer = "";
      let stderrOutput = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) handleRaw(trimmed);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      // Records why the container was force-killed, if it was — mutually
      // exclusive, so a single value is clearer than two booleans.
      let killReason: "timeout" | "cancelled" | null = null;

      // Timeout: 30 minutes per tool. Kill the container, not just the CLI.
      const timeout = setTimeout(() => {
        killReason = "timeout";
        killContainer("timed out after 30 minutes");
      }, 30 * 60 * 1000);

      // Cancellation via AbortSignal — kill the container immediately.
      const onAbort = (): void => {
        killReason = "cancelled";
        killContainer("cancelled");
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener("abort", onAbort);
      };

      child.on("close", (code) => {
        cleanup();
        // Process any remaining buffered line.
        const tail = buffer.trim();
        if (tail) handleRaw(tail);

        if (code !== 0 && !killReason) {
          logger.error(
            `[DockerRunner] ${tool} worker exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`
          );
        }

        // Wait for all queued persistence to finish before resolving so callers
        // observe a fully-persisted scan.
        persistChain.finally(() => {
          const suffix = killReason === "timeout" ? ", timed out" : killReason === "cancelled" ? ", cancelled" : "";
          logger.info(`[DockerRunner] ${tool} worker completed (${results.length} results${suffix}).`);
          resolve(results);
        });
      });

      child.on("error", (err) => {
        cleanup();
        logger.error(`[DockerRunner] Failed to spawn docker for ${tool}: ${err.message}`);
        reject(err);
      });
    });
  }
}
