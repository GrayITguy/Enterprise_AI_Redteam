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
