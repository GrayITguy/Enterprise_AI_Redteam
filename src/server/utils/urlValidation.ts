/**
 * SSRF-prevention utilities.
 *
 * The primary defence is an **allowlist** of target hostnames. Only hosts
 * present in the set are eligible for outbound `fetch()` calls.
 *
 * Default entries cover local Ollama and Docker-internal addresses.
 * Additional hosts can be configured via the `ALLOWED_TARGET_HOSTS`
 * environment variable (comma-separated).
 *
 * IMPORTANT — the Set is intentionally exported and used with
 * `ALLOWED_TARGET_HOSTS.has(url.hostname)` at every fetch call-site so
 * that static-analysis tools (CodeQL `js/request-forgery`) can verify
 * the hostname guard inline.
 */

/** Hostname allowlist — only these hosts may be targets of outbound requests. */
export const ALLOWED_TARGET_HOSTS: Set<string> = new Set([
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
]);

// Merge in any admin-configured hosts from the environment.
for (const h of (process.env.ALLOWED_TARGET_HOSTS ?? "").split(",")) {
  const trimmed = h.trim().toLowerCase();
  if (trimmed) ALLOWED_TARGET_HOSTS.add(trimmed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Denylist guard for the AI-provider / custom-endpoint paths.
//
// Those paths legitimately reach arbitrary external SaaS APIs (api.openai.com)
// AND a local Ollama, so a hostname *allowlist* cannot gate them without
// breaking real use. Instead we block the targets that have no legitimate use
// in this app and are the classic SSRF payloads: cloud-metadata services and
// link-local addresses. Loopback and private-LAN hosts stay reachable because
// self-hosted models legitimately live there.
// ─────────────────────────────────────────────────────────────────────────────

/** Hostnames that resolve to cloud instance-metadata services. */
const BLOCKED_METADATA_HOSTS: Set<string> = new Set([
  "169.254.169.254", // AWS / Azure / GCP / DigitalOcean IMDS
  "169.254.170.2", // AWS ECS task metadata
  "metadata.google.internal",
  "metadata",
  "fd00:ec2::254", // AWS IMDS over IPv6
]);

/** True when the hostname is an IPv4/IPv6 link-local address (169.254/16, fe80::/10). */
function isLinkLocal(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true; // IPv4 link-local
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true; // IPv6 link-local fe80::/10
  }
  return false;
}

export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/**
 * Throw {@link BlockedTargetError} if `rawUrl` is not a safe outbound target.
 * Enforces http(s) only and blocks cloud-metadata + link-local addresses.
 * Use this on every path that fetches a user-supplied URL which is NOT already
 * gated by the {@link ALLOWED_TARGET_HOSTS} allowlist.
 */
export function assertUrlNotBlocked(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError("Invalid URL format");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedTargetError("Only http and https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_METADATA_HOSTS.has(host) || isLinkLocal(host)) {
    throw new BlockedTargetError(
      `Target host '${parsed.hostname}' is blocked (cloud metadata / link-local address)`
    );
  }
}
