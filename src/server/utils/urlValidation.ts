import { URL } from "node:url";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP metadata
  "metadata.internal",
]);

const PRIVATE_IP_PATTERNS = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // loopback
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,  // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12
  /^192\.168\.\d{1,3}\.\d{1,3}$/,      // 192.168.0.0/16
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,     // IPv6 loopback
  /^\[?fe80:/i,      // IPv6 link-local
  /^\[?fc/i,         // IPv6 unique-local
  /^\[?fd/i,         // IPv6 unique-local
];

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
 * Validates a user-supplied URL to prevent SSRF attacks.
 * - Only http and https schemes are allowed.
 * - Cloud metadata endpoints and internal IP ranges (except localhost) are blocked.
 *
 * Returns the parsed URL on success or throws an error.
 */
export function validateUserUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  // Only allow http/https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL scheme '${parsed.protocol}' is not allowed. Only http and https are permitted.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block cloud metadata endpoints
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("Access to this host is not permitted");
  }

  // Allow explicitly permitted private hosts (localhost for Ollama, etc.)
  if (ALLOWED_PRIVATE.has(hostname)) {
    return parsed;
  }

  // Block other private/internal IPs
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error("Access to private network addresses is not permitted");
    }
  }

  return parsed;
}
