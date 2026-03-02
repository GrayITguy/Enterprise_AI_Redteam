import fs from "node:fs";

let _inDocker: boolean | null = null;

/**
 * Detect whether the current process is running inside a Docker container.
 * Checks for the `/.dockerenv` sentinel file that Docker creates in every
 * container.  The result is cached after the first call.
 */
export function isRunningInDocker(): boolean {
  if (_inDocker !== null) return _inDocker;
  try {
    _inDocker = fs.existsSync("/.dockerenv");
  } catch {
    _inDocker = false;
  }
  return _inDocker;
}

/**
 * When running inside Docker, rewrite `localhost` / `127.0.0.1` URLs to
 * `host.docker.internal` so the container can reach services on the host
 * machine (e.g. a user's local Ollama instance).
 *
 * When running natively (outside Docker), returns the URL unchanged.
 *
 * Requires `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux
 * (macOS / Windows Docker Desktop resolve it automatically).
 */
export function resolveForHost(url: string): string {
  if (!isRunningInDocker()) return url;
  return url
    .replace(/\/\/localhost([:/])/g, "//host.docker.internal$1")
    .replace(/\/\/127\.0\.0\.1([:/])/g, "//host.docker.internal$1");
}
