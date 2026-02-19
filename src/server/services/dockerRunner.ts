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
    const configJson = JSON.stringify(config);
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
        "--network=host", // allow reaching Ollama or OpenAI on the host
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
        // Return empty results rather than crashing the whole scan
        resolve([]);
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
