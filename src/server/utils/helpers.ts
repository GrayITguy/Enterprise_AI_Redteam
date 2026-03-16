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
