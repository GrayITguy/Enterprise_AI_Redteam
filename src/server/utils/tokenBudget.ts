/**
 * Lightweight token estimation and context-window budget management.
 *
 * No external tokeniser dependency — uses a conservative chars-per-token
 * heuristic that intentionally over-estimates so we stay within limits.
 */

/** Approximate token count (1 token ≈ 3.5 characters on average). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Known context-window sizes keyed by model-name prefix.
 * Order matters — first match wins, so put longer/more-specific prefixes first.
 */
const KNOWN_CONTEXT_WINDOWS: [prefix: string, tokens: number][] = [
  // OpenAI
  ["gpt-4o", 128_000],
  ["gpt-4-turbo", 128_000],
  ["gpt-4", 8_192],
  ["gpt-3.5-turbo-16k", 16_384],
  ["gpt-3.5-turbo", 16_384],
  ["o1", 200_000],
  ["o3", 200_000],

  // Anthropic
  ["claude-opus", 200_000],
  ["claude-sonnet", 200_000],
  ["claude-haiku", 200_000],
  ["claude-3", 200_000],
  ["claude-4", 200_000],

  // Ollama / open-source common models
  ["llama3.1", 131_072],
  ["llama3:70b", 8_192],
  ["llama3", 8_192],
  ["llama2", 4_096],
  ["mistral-large", 128_000],
  ["mistral", 32_768],
  ["mixtral", 32_768],
  ["codellama", 16_384],
  ["phi-3", 128_000],
  ["phi", 4_096],
  ["gemma2", 8_192],
  ["gemma", 8_192],
  ["qwen3", 32_768],
  ["qwen2.5", 131_072],
  ["qwen2", 131_072],
  ["qwen", 32_768],
  ["deepseek-coder", 128_000],
  ["deepseek", 128_000],
  ["command-r", 128_000],
];

const DEFAULT_CONTEXT_WINDOW = 32_768;

/**
 * Best-effort context-window lookup.
 * Returns null when the model is unknown — callers can then decide whether to
 * use a fallback (for budget calculations) or omit the parameter entirely
 * (for Ollama num_ctx, where omitting lets the model use its own default).
 */
export function getContextWindow(
  model: string,
  _providerType: string
): number | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  for (const [prefix, size] of KNOWN_CONTEXT_WINDOWS) {
    if (lower.startsWith(prefix)) return size;
  }
  return null;
}

/**
 * Same as getContextWindow but always returns a number, using the default
 * fallback for unknown models. Use this for token-budget calculations where
 * a concrete number is always required.
 */
export function getContextWindowWithDefault(
  model: string,
  providerType: string
): number {
  return getContextWindow(model, providerType) ?? DEFAULT_CONTEXT_WINDOW;
}

export interface TokenBudget {
  /** Maximum tokens the model can generate in its response. */
  maxCompletionTokens: number;
  /** Whether the input prompt fits within the context window. */
  inputFits: boolean;
}

/**
 * Given an estimated input size and a context window, compute how many tokens
 * we can safely request for the completion.
 *
 * Reserves a 10 % safety margin on the context window and enforces a floor of
 * 1 024 completion tokens (below that the model can't produce useful output).
 */
export function computeBudget(
  promptTokens: number,
  contextWindow: number
): TokenBudget {
  const safeWindow = Math.floor(contextWindow * 0.9);
  const available = safeWindow - promptTokens;
  const maxCompletionTokens = Math.max(available, 1024);
  return {
    maxCompletionTokens,
    inputFits: promptTokens < safeWindow,
  };
}
