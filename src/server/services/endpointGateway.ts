import http from "node:http";
import { logger } from "../utils/logger.js";
import { resolveForHost } from "../utils/resolveEndpoint.js";
import { getOllamaTimeoutMs } from "../utils/ollamaTimeout.js";

/**
 * Endpoint Auto-Bridge — lightweight HTTP reverse proxy.
 *
 * Runs on the host machine, listens on 0.0.0.0 (reachable from Docker via
 * host.docker.internal), and forwards every request to the real target
 * (e.g. localhost:11434 for Ollama).
 *
 * Reference-counted so multiple concurrent scans share a single gateway
 * instance.  Auto-stops when the last scan releases its reference.
 */
export class EndpointGateway {
  private server: http.Server | null = null;
  private port = 0;
  private refCount = 0;
  private targetOrigin = "";
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Start the gateway (idempotent — reuses existing server for the same target). */
  async start(targetUrl: string): Promise<number> {
    // In Docker, localhost refers to the container — rewrite to host.docker.internal
    const origin = new URL(resolveForHost(targetUrl)).origin;

    if (this.server && this.targetOrigin === origin) {
      // Already running for this target
      this.resetIdleTimer();
      return this.port;
    }

    // If running for a different target, stop first
    if (this.server) {
      await this.forceStop();
    }

    this.targetOrigin = origin;

    return new Promise<number>((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        this.proxy(req, res);
      });

      srv.on("error", (err) => {
        logger.error(`[EndpointGateway] Server error: ${err.message}`);
        reject(err);
      });

      // Bind to port 0 → OS assigns a free port
      srv.listen(0, "0.0.0.0", () => {
        const addr = srv.address();
        this.port = typeof addr === "object" && addr ? addr.port : 0;
        this.server = srv;
        this.resetIdleTimer();
        logger.info(
          `[EndpointGateway] Listening on 0.0.0.0:${this.port} → ${this.targetOrigin}`
        );
        resolve(this.port);
      });
    });
  }

  /** Increment reference count — call before starting a scan. */
  acquire(): void {
    this.refCount++;
    this.resetIdleTimer();
    logger.debug(`[EndpointGateway] acquire → refCount=${this.refCount}`);
  }

  /** Decrement reference count — call after a scan completes.  Auto-stops when 0. */
  release(): void {
    this.refCount = Math.max(0, this.refCount - 1);
    logger.debug(`[EndpointGateway] release → refCount=${this.refCount}`);
    if (this.refCount === 0) {
      // Give a short grace period before shutting down (another scan may start soon)
      this.resetIdleTimer(10_000);
    }
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  /** Immediately shut down the gateway. */
  async forceStop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.server) return;

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        logger.info("[EndpointGateway] Stopped");
        this.server = null;
        this.port = 0;
        this.refCount = 0;
        this.targetOrigin = "";
        resolve();
      });
    });
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private resetIdleTimer(ms = 30 * 60 * 1000): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.refCount === 0) {
        logger.info("[EndpointGateway] Idle timeout — shutting down");
        this.forceStop();
      }
    }, ms);
  }

  private proxy(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const targetUrl = `${this.targetOrigin}${clientReq.url ?? "/"}`;

    const parsed = new URL(targetUrl);
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: parsed.host,
      },
      timeout: Math.max(120_000, getOllamaTimeoutMs()),
    };

    const proxyReq = http.request(options, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    });

    proxyReq.on("error", (err) => {
      logger.error(`[EndpointGateway] Proxy error → ${targetUrl}: ${err.message}`);
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { "Content-Type": "application/json" });
      }
      clientRes.end(
        JSON.stringify({
          error: "gateway_error",
          message: `Failed to reach ${this.targetOrigin}: ${err.message}`,
        })
      );
    });

    proxyReq.on("timeout", () => {
      const secs = Math.round(Math.max(120_000, getOllamaTimeoutMs()) / 1000);
      proxyReq.destroy(new Error(`Gateway proxy request timed out (${secs}s)`));
    });

    clientReq.pipe(proxyReq, { end: true });
  }
}

/** Singleton gateway instance shared across all scans. */
export const gateway = new EndpointGateway();
