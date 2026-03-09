/**
 * Ollama request timeout in milliseconds, configurable via OLLAMA_TIMEOUT env
 * var (value in **seconds**).  Default: 900 s (15 minutes).
 */
export function getOllamaTimeoutMs(): number {
  const secs = parseInt(process.env.OLLAMA_TIMEOUT ?? "900", 10);
  return (Number.isFinite(secs) && secs > 0 ? secs : 900) * 1000;
}
