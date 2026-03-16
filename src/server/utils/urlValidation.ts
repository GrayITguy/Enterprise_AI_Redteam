import { URL } from "node:url";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP metadata
  "metadata.internal",
]);

/**
 * Allowed private/local hostnames that are explicitly needed by the application.
 * localhost / 127.0.0.1 are permitted because users commonly run Ollama locally.
 */
export const ALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
]);

/**
 * Check if an IP address string belongs to a private/internal range.
 */
export function isPrivateIP(ip: string): boolean {
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("0.")) return true;
  if (ip === "169.254.169.254") return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;

  const lowerIp = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (lowerIp === "::1") return true;
  if (lowerIp.startsWith("fe80:")) return true;
  if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return true;

  return false;
}

/**
 * Returns true if the hostname is safe to make outbound requests to.
 * This is an ALLOWLIST check: returns true only for known-safe hosts
 * (explicit allowlist + public multi-label hostnames that aren't
 * cloud metadata endpoints).
 *
 * Designed to be used as an inline guard that static analysis tools
 * (CodeQL) can recognise as an SSRF sanitiser.
 */
export function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Explicit allowlist (localhost, docker-internal, etc.)
  if (ALLOWED_HOSTS.has(h)) return true;

  // Block cloud metadata endpoints
  if (BLOCKED_HOSTNAMES.has(h)) return false;

  // Block private IPs (that aren't in the explicit allowlist)
  if (net.isIP(h) && isPrivateIP(h)) return false;

  // Block single-label hostnames (e.g. "redis", "db") which typically
  // resolve to internal Docker/Kubernetes services.
  if (!h.includes(".")) return false;

  // Everything else (public FQDN or public IP) is allowed
  return true;
}
