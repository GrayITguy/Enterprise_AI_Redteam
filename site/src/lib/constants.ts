/** Severity sort order (lower = more severe). */
export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Severity hex colors for charts and badges. */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
  info: "#3b82f6",
};

/** OWASP LLM Top 10 short display names. */
export const OWASP_NAMES: Record<string, string> = {
  LLM01: "Prompt Injection",
  LLM02: "Insecure Output",
  LLM03: "Data Poisoning",
  LLM04: "Denial of Service",
  LLM05: "Supply Chain",
  LLM06: "Info Disclosure",
  LLM07: "Plugin Design",
  LLM08: "Excessive Agency",
  LLM09: "Overreliance",
  LLM10: "Model Theft",
};
