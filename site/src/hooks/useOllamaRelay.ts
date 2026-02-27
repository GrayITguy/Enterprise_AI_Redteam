import { useEffect } from "react";

/**
 * Browser-side Ollama relay.
 *
 * The EART backend cannot reach localhost:11434 when hosted remotely, but the
 * browser can.  This hook long-polls the backend for pending Ollama requests,
 * forwards each one to the user's local Ollama instance, then posts the
 * response back — acting as a transparent bridge.
 *
 * Mount this hook inside any component that is always rendered while the user
 * is authenticated (e.g. the RequireAuth wrapper in App.tsx).  The relay runs
 * continuously in the background with minimal overhead: one long-poll request
 * per 30 seconds when idle.
 */
export function useOllamaRelay(): void {
  useEffect(() => {
    let active = true;

    const sleep = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));

    const loop = async () => {
      while (active) {
        try {
          // Long-poll: backend holds the connection open for up to 30 s.
          const res = await fetch("/api/ollama/relay/poll", {
            signal: AbortSignal.timeout(35_000),
          });

          if (!res.ok) {
            await sleep(2_000);
            continue;
          }

          const item = (await res.json()) as {
            idle?: boolean;
            requestId?: string;
            ollamaUrl?: string;
            path?: string;
            body?: unknown;
          };

          // Backend returned null (idle timeout) — just re-poll immediately.
          if (item.idle || !item.requestId) continue;

          const { requestId, ollamaUrl, path, body } = item as {
            requestId: string;
            ollamaUrl: string;
            path: string;
            body: unknown;
          };

          // Forward to the user's local Ollama and post the result back.
          try {
            // Intentionally omit Content-Type so the browser sends text/plain
            // (a "simple" CORS request — no preflight OPTIONS sent).
            // Ollama's Go handler decodes JSON from the body regardless of
            // Content-Type, so the request is still processed correctly.
            const r = await fetch(`${ollamaUrl}${path}`, {
              method: "POST",
              body: JSON.stringify(body),
            });

            if (!r.ok) {
              throw new Error(`Ollama returned HTTP ${r.status}`);
            }

            const data: unknown = await r.json();

            await fetch("/api/ollama/relay/fulfill", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requestId, data }),
            });
          } catch (err) {
            // Report the error so the backend promise rejects cleanly.
            await fetch("/api/ollama/relay/fulfill", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requestId, error: String(err) }),
            });
          }
        } catch {
          // AbortError on timeout or network hiccup — brief pause then retry.
          if (active) await sleep(1_000);
        }
      }
    };

    loop();

    return () => {
      active = false;
    };
  }, []);
}
