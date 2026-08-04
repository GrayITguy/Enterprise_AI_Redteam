/** Check whether a URL points to the local machine. */
export function isLocalhostUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

/** Safely parse a JSON string, returning a fallback value on failure. */
export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Extract a human-readable error message from an unknown caught value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wrap an async Express route handler so rejected promises are forwarded
 * to Express's error handler via next(). Required for Express 4 which
 * does not handle async rejections natively.
 */
export function asyncHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: (req: any, res: import("express").Response, next: import("express").NextFunction) => Promise<unknown>
): import("express").RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Resolve the effective Ollama base URL from env / config / default,
 * stripping any trailing slashes.
 */
export function resolveOllamaUrl(targetUrl?: string): string {
  return (
    process.env.OLLAMA_URL || targetUrl || "http://localhost:11434"
  ).replace(/\/+$/, "");
}

/** Provider-config keys that hold secrets and must never be returned to clients. */
const SECRET_CONFIG_KEYS = ["apiKey", "apikey", "api_key", "token", "password"];

/**
 * Redact secret values from a project's providerConfig before sending it to the
 * client. The raw `apiKey` (and similar) is removed and replaced with a boolean
 * `hasApiKey` flag, mirroring how SMTP passwords are handled in Settings.
 */
export function redactProviderConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  let hasApiKey = false;
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_CONFIG_KEYS.includes(key)) {
      if (value) hasApiKey = true;
      continue;
    }
    if (key === "headers" && value && typeof value === "object") {
      // Strip Authorization-style header values but keep the header names.
      const headers = value as Record<string, unknown>;
      redacted.headers = Object.fromEntries(
        Object.entries(headers).map(([h, v]) =>
          /^(authorization|x-api-key|api-key)$/i.test(h) && v ? [h, "***"] : [h, v]
        )
      );
      continue;
    }
    redacted[key] = value;
  }
  redacted.hasApiKey = hasApiKey;
  return redacted;
}

/**
 * Merge an incoming providerConfig over a stored one, preserving the existing
 * secret when the client omits it (so a save that doesn't re-send the key does
 * not wipe it) — matches the SMTP "leave blank to keep" behaviour.
 */
export function mergeProviderSecrets(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...incoming };
  for (const key of SECRET_CONFIG_KEYS) {
    if (!merged[key] && stored[key]) merged[key] = stored[key];
  }
  return merged;
}
