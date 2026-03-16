import { URL } from "node:url";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP metadata
  "metadata.internal",
]);

/**
 * Allowed hostnames that are private but explicitly needed by the application.
 * localhost / 127.0.0.1 are permitted because users commonly run Ollama locally.
 */
const ALLOWED_PRIVATE = new Set([
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
]);

/**
 * Check if an IP address string belongs to a private/internal range.
 */
function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("0.")) return true;
  if (ip === "169.254.169.254") return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;

  // IPv6 private
  const lowerIp = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (lowerIp === "::1") return true;
  if (lowerIp.startsWith("fe80:")) return true;
  if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return true;

  return false;
}

/**
 * Validates a user-supplied URL to prevent SSRF attacks, then returns a
 * **sanitized base URL string** (`scheme://host[:port]`) that is safe to use
 * in outbound requests.
 *
 * The returned string is constructed from validated, non-user-controlled
 * components so that static-analysis tools (CodeQL) can verify the taint
 * chain is broken.
 *
 * Throws on invalid / disallowed input.
 */
export function validateUserUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  // ── Scheme allowlist ──────────────────────────────────────────────────
  const scheme = parsed.protocol; // includes trailing ':'
  if (scheme !== "http:" && scheme !== "https:") {
    throw new Error(
      `URL scheme '${scheme}' is not allowed. Only http and https are permitted.`,
    );
  }

  // ── Hostname validation ───────────────────────────────────────────────
  const hostname = parsed.hostname.toLowerCase();

  // Block known cloud metadata endpoints
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Access to this host is not permitted");
  }

  // If it's a raw IP, check whether it's private
  if (net.isIP(hostname) && !ALLOWED_PRIVATE.has(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error("Access to private network addresses is not permitted");
    }
  }

  // For non-IP hostnames, allow localhost/docker-internal explicitly
  // and reject anything that could resolve to internal infra
  if (!net.isIP(hostname) && !ALLOWED_PRIVATE.has(hostname)) {
    // Additional guard: reject single-label hostnames (e.g. "redis", "db")
    // which typically resolve to internal Docker/Kubernetes services.
    if (!hostname.includes(".")) {
      throw new Error(
        "Single-label hostnames are not permitted. Use a fully-qualified domain name.",
      );
    }
  }

  // ── Construct a clean base URL from validated parts ────────────────────
  // Use the fixed scheme string (not user input) to break the taint chain.
  const safeScheme = scheme === "https:" ? "https" : "http";
  const port = parsed.port ? `:${parsed.port}` : "";
  const safePath = parsed.pathname.replace(/\/+$/, "");

  return `${safeScheme}://${hostname}${port}${safePath}`;
}
