import { spawn } from "child_process";
import { logger } from "../utils/logger.js";

export interface DockerScanResult {
  testName: string;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  owaspCategory?: string;
  prompt?: string;
  response?: string;
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
}

/** Convert camelCase config keys to snake_case for Python workers. */
function toSnakeConfig(config: DockerRunConfig): Record<string, unknown> {
  const { gatewayPort, ...rest } = config;
  let targetUrl = rest.targetUrl;

  // When a gateway port is provided, rewrite localhost URLs so the Docker
  // container reaches the host-side gateway via host.docker.internal.
  if (gatewayPort && isLocalhostUrl(targetUrl)) {
    const parsed = new URL(targetUrl);
    targetUrl = `http://host.docker.internal:${gatewayPort}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    logger.info(`[DockerRunner] Rewrote target URL → ${targetUrl}`);
  }

  return {
    target_url: targetUrl,
    model: rest.model,
    provider_type: rest.providerType,
    provider_config: rest.providerConfig,
    plugins: rest.plugins,
    tool: rest.tool,
  };
}

/** Check whether a URL points to the local machine. */
function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
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
    onResult?: (result: DockerScanResult) => Promise<void>
  ): Promise<DockerScanResult[]> {
    const image = this.getImage(tool);
    // Convert to snake_case for Python workers and apply gateway URL rewriting
    const snakeConfig = toSnakeConfig(config);
    const configJson = JSON.stringify(snakeConfig);
    const results: DockerScanResult[] = [];

    logger.info(`[DockerRunner] Starting ${tool} worker (image: ${image})`);

    return new Promise((resolve, reject) => {
      const args = [
        "run",
        "--rm",
        "-i",
        "--memory=2g",
        "--cpus=1",
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

      // Send config as JSON on stdin
      child.stdin.write(configJson + "\n");
      child.stdin.end();

      let buffer = "";
      let stderrOutput = "";

      // Parse JSONL from stdout
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const result = JSON.parse(trimmed) as DockerScanResult;
            results.push(result);
            if (onResult) {
              onResult(result).catch((err) =>
                logger.error(`[DockerRunner] onResult callback error: ${err.message}`)
              );
            }
          } catch (parseErr) {
            logger.warn(`[DockerRunner] Failed to parse JSONL line: ${trimmed.slice(0, 100)}`);
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString();
      });

      child.on("close", (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const result = JSON.parse(buffer.trim()) as DockerScanResult;
            results.push(result);
          } catch {
            // ignore
          }
        }

        if (code !== 0) {
          logger.error(
            `[DockerRunner] ${tool} worker exited with code ${code}. stderr: ${stderrOutput.slice(0, 500)}`
          );
          // Don't reject — return whatever results we got
        }

        logger.info(`[DockerRunner] ${tool} worker completed. ${results.length} results.`);
        resolve(results);
      });

      child.on("error", (err) => {
        logger.error(`[DockerRunner] Failed to spawn docker for ${tool}: ${err.message}`);
        clearTimeout(timeout);
        reject(err);
      });

      // Timeout: 30 minutes per tool
      const timeout = setTimeout(() => {
        logger.warn(`[DockerRunner] ${tool} worker timed out after 30 minutes`);
        child.kill("SIGTERM");
      }, 30 * 60 * 1000);

      child.on("close", () => clearTimeout(timeout));
    });
  }
}
