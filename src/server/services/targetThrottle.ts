/**
 * Outbound target-model call throttle.
 *
 * Bounds how fast EART hammers a target model on the paths it fully controls
 * (the promptfoo / Ollama / custom attack loop). `SCAN_TARGET_RATE_LIMIT` is in
 * calls-per-minute; 0 (default) means unlimited. Enforced as a minimum spacing
 * between successive calls — simple and sufficient for a sequential loop.
 *
 * Note: the Dockerised workers (garak / pyrit / deepteam) make their own calls
 * inside their containers and are bounded by their own prompt/turn caps
 * (GARAK_PROMPT_CAP, PYRIT_TREE_*, DEEPTEAM_*), not by this throttle.
 */
let lastCallAt = 0;

function ratePerMinute(): number {
  const v = Number(process.env.SCAN_TARGET_RATE_LIMIT);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Await the minimum inter-call spacing implied by SCAN_TARGET_RATE_LIMIT. */
export async function throttleTargetCall(): Promise<void> {
  const rpm = ratePerMinute();
  if (rpm === 0) return;
  const minIntervalMs = 60_000 / rpm;
  const now = Date.now();
  const wait = lastCallAt + minIntervalMs - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallAt = Date.now();
}

/** Test-only: reset the internal clock. */
export function _resetThrottle(): void {
  lastCallAt = 0;
}
