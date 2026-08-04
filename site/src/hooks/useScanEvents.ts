import { useEffect, useRef } from "react";

export interface ScanProgressEvent {
  scanId: string;
  status: string;
  progress: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

/**
 * Subscribe to a scan's live progress over Server-Sent Events.
 *
 * Uses `fetch` + a streaming reader (not `EventSource`) so the JWT can travel in
 * the Authorization header. It's a best-effort enhancement layered over the
 * component's existing polling — if the stream never connects or drops, polling
 * still drives the UI, so failures here are silent by design.
 */
export function useScanEvents(
  scanId: string | undefined,
  enabled: boolean,
  onProgress: (e: ScanProgressEvent) => void,
  onDone: () => void
): void {
  // Keep the latest callbacks without re-opening the stream on every render.
  const onProgressRef = useRef(onProgress);
  const onDoneRef = useRef(onDone);
  onProgressRef.current = onProgress;
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!scanId || !enabled) return;
    const token = localStorage.getItem("eart_token");
    if (!token) return;

    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/scans/${scanId}/events`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            if (event === "progress") {
              try {
                onProgressRef.current(JSON.parse(data) as ScanProgressEvent);
              } catch {
                /* ignore malformed frame */
              }
            } else if (event === "done") {
              onDoneRef.current();
            }
          }
        }
      } catch {
        /* aborted or network error — polling fallback keeps the UI live */
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scanId, enabled]);
}
