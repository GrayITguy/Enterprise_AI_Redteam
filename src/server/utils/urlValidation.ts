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

import net from "node:net";

/** Hostnames (non-IP) that resolve to cloud instance-metadata services. */
const BLOCKED_METADATA_HOSTNAMES: Set<string> = new Set([
  "metadata.google.internal",
  "metadata",
]);

/**
 * Expand an IPv6 literal into its 8 numeric 16-bit groups, or null if it isn't
 * valid IPv6. Handles `::` compression and a trailing embedded IPv4
 * (e.g. `::ffff:169.254.169.254`), so every textual form of an address maps to
 * the same groups and can't be used to dodge a string-based denylist.
 */
function ipv6Groups(addr: string): number[] | null {
  if (!net.isIPv6(addr)) return null;
  let s = addr.toLowerCase();

  // Fold a trailing dotted-IPv4 tail into two hex groups.
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    const g6 = ((o[0]! << 8) | o[1]!).toString(16);
    const g7 = ((o[2]! << 8) | o[3]!).toString(16);
    s = s.slice(0, v4.index) + g6 + ":" + g7;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  return parts.map((g) => parseInt(g || "0", 16));
}

/** True for IPv4 link-local / cloud-metadata addresses (169.254.0.0/16). */
function isBlockedIpv4(host: string): boolean {
  return /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host); // covers 169.254.169.254 and 169.254.170.2
}

/**
 * True when a host is a blocked IP in ANY textual form: IPv4 link-local,
 * IPv4-mapped IPv6 of a link-local address, IPv6 link-local (fe80::/10), or the
 * AWS IPv6 IMDS address fd00:ec2::254 (in compressed or expanded form).
 */
function isBlockedIp(host: string): boolean {
  if (net.isIPv4(host)) return isBlockedIpv4(host);

  const g = ipv6Groups(host);
  if (!g) return false;

  // IPv4-mapped (::ffff:a.b.c.d) — unwrap and apply the IPv4 rule.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${(g[6]! >> 8) & 0xff}.${g[6]! & 0xff}.${(g[7]! >> 8) & 0xff}.${g[7]! & 0xff}`;
    return isBlockedIpv4(v4);
  }
  // IPv6 link-local fe80::/10.
  if ((g[0]! & 0xffc0) === 0xfe80) return true;
  // AWS IPv6 instance-metadata service fd00:ec2::254.
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g[2] === 0 && g[3] === 0 &&
      g[4] === 0 && g[5] === 0 && g[6] === 0 && g[7] === 0x254) return true;

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
 * Enforces http(s) only and blocks cloud-metadata + link-local addresses in any
 * textual form (dotted, IPv4-mapped, or compressed/expanded IPv6).
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
  // new URL() keeps IPv6 literals bracketed — strip before matching.
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_METADATA_HOSTNAMES.has(host) || isBlockedIp(host)) {
    throw new BlockedTargetError(
      `Target host '${parsed.hostname}' is blocked (cloud metadata / link-local address)`
    );
  }
}
