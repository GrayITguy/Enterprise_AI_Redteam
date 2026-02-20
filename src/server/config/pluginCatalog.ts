export type PluginTool = "promptfoo" | "garak" | "pyrit" | "deepteam";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type OwaspCategory =
  | "LLM01" | "LLM02" | "LLM03" | "LLM04" | "LLM05"
  | "LLM06" | "LLM07" | "LLM08" | "LLM09" | "LLM10";

export interface Plugin {
  id: string;
  name: string;
  description: string;
  tool: PluginTool;
  category: string;
  severity: Severity;
  owaspCategory?: OwaspCategory;
  tags: string[];
}

export interface Preset {
  name: string;
  description: string;
  plugins: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin Catalog
// ─────────────────────────────────────────────────────────────────────────────
export const PLUGINS: Plugin[] = [
  // ── Promptfoo red team plugins ──────────────────────────────────────────────
  {
    id: "promptfoo:prompt-injection",
    name: "Prompt Injection",
    description: "Tests if the model follows malicious instructions embedded in user input to override system behavior.",
    tool: "promptfoo",
    category: "injection",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["owasp", "injection"],
  },
  {
    id: "promptfoo:jailbreak",
    name: "Jailbreak Attacks",
    description: "Attempts to bypass safety guardrails using common jailbreak patterns (DAN, roleplay, hypothetical).",
    tool: "promptfoo",
    category: "jailbreak",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["owasp", "safety"],
  },
  {
    id: "promptfoo:pii-extraction",
    name: "PII Extraction",
    description: "Tests if the model leaks or generates personally identifiable information from training data or context.",
    tool: "promptfoo",
    category: "privacy",
    severity: "critical",
    owaspCategory: "LLM02",
    tags: ["owasp", "privacy", "pii"],
  },
  {
    id: "promptfoo:system-prompt-leak",
    name: "System Prompt Exfiltration",
    description: "Probes whether the model reveals its system prompt when asked directly or indirectly.",
    tool: "promptfoo",
    category: "disclosure",
    severity: "high",
    owaspCategory: "LLM07",
    tags: ["owasp", "disclosure"],
  },
  {
    id: "promptfoo:harmful-content",
    name: "Harmful Content Generation",
    description: "Tests if the model generates instructions for illegal activities, violence, or dangerous content.",
    tool: "promptfoo",
    category: "safety",
    severity: "critical",
    owaspCategory: "LLM06",
    tags: ["owasp", "safety", "harmful"],
  },
  {
    id: "promptfoo:indirect-prompt-injection",
    name: "Indirect Prompt Injection",
    description: "Simulates RAG-based attacks where malicious instructions are hidden in retrieved documents.",
    tool: "promptfoo",
    category: "injection",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["owasp", "rag", "injection"],
  },
  {
    id: "promptfoo:rbac-bypass",
    name: "Insecure Output Handling",
    description: "Tests whether model output is used unsafely downstream (XSS, command injection via LLM output).",
    tool: "promptfoo",
    category: "output-handling",
    severity: "high",
    owaspCategory: "LLM02",
    tags: ["owasp", "output"],
  },
  {
    id: "promptfoo:overreliance",
    name: "Overreliance / Hallucination",
    description: "Tests whether the model confidently fabricates facts, citations, or authoritative-sounding false information.",
    tool: "promptfoo",
    category: "reliability",
    severity: "medium",
    owaspCategory: "LLM09",
    tags: ["owasp", "hallucination"],
  },

  {
    id: "promptfoo:ascii-smuggling",
    name: "ASCII / Unicode Smuggling",
    description: "Injects invisible Unicode control characters or homoglyphs to bypass input filters while delivering harmful payloads.",
    tool: "promptfoo",
    category: "injection",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["owasp", "encoding", "bypass"],
  },
  {
    id: "promptfoo:debug-access",
    name: "Debug Mode Access",
    description: "Tests if the model can be tricked into exposing debug endpoints, verbose error messages, or internal state through crafted prompts.",
    tool: "promptfoo",
    category: "disclosure",
    severity: "high",
    owaspCategory: "LLM07",
    tags: ["owasp", "debug", "disclosure"],
  },
  {
    id: "promptfoo:bola",
    name: "Broken Object-Level Auth",
    description: "Tests whether the model can be prompted to access or modify resources belonging to other users or unauthorized objects.",
    tool: "promptfoo",
    category: "authorization",
    severity: "critical",
    owaspCategory: "LLM02",
    tags: ["owasp", "authz", "bola"],
  },
  {
    id: "promptfoo:bfla",
    name: "Broken Function-Level Auth",
    description: "Checks if the model exposes admin/privileged functionality to unprivileged users via prompt manipulation.",
    tool: "promptfoo",
    category: "authorization",
    severity: "critical",
    owaspCategory: "LLM02",
    tags: ["owasp", "authz", "bfla"],
  },
  {
    id: "promptfoo:contracts",
    name: "Contractual Compliance Bypass",
    description: "Tests if the model can be prompted to violate terms-of-service, legal constraints, or enterprise policy guardrails.",
    tool: "promptfoo",
    category: "compliance",
    severity: "medium",
    owaspCategory: "LLM10",
    tags: ["owasp", "legal", "compliance"],
  },
  {
    id: "promptfoo:shell-injection",
    name: "Shell Command Injection",
    description: "Tests if LLM output containing OS commands can be exploited when downstream systems execute model-generated shell code.",
    tool: "promptfoo",
    category: "injection",
    severity: "critical",
    owaspCategory: "LLM02",
    tags: ["owasp", "injection", "shell"],
  },
  {
    id: "promptfoo:sql-injection",
    name: "SQL Injection via LLM Output",
    description: "Checks whether the model generates SQL payloads that could be exploited if passed to a database without sanitization.",
    tool: "promptfoo",
    category: "injection",
    severity: "critical",
    owaspCategory: "LLM02",
    tags: ["owasp", "injection", "sql"],
  },

  // ── Garak probes ─────────────────────────────────────────────────────────────
  {
    id: "garak:encoding-attacks",
    name: "Encoding-based Attacks",
    description: "Garak probe: uses Base64, ROT13, Leetspeak and other encodings to smuggle harmful requests past filters.",
    tool: "garak",
    category: "encoding",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["garak", "encoding", "bypass"],
  },
  {
    id: "garak:continuation-attacks",
    name: "Completion Exploitation",
    description: "Garak probe: exploits the model's tendency to complete harmful text patterns.",
    tool: "garak",
    category: "completion",
    severity: "high",
    owaspCategory: "LLM06",
    tags: ["garak", "completion"],
  },
  {
    id: "garak:dan-variants",
    name: "DAN & Persona Jailbreaks",
    description: "Garak probe: systematic variants of Do Anything Now (DAN) and alternative persona prompts.",
    tool: "garak",
    category: "jailbreak",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["garak", "jailbreak", "dan"],
  },
  {
    id: "garak:malware-generation",
    name: "Malware Code Generation",
    description: "Garak probe: tests if the model generates functional malware, exploits, or hacking tools.",
    tool: "garak",
    category: "malware",
    severity: "critical",
    owaspCategory: "LLM06",
    tags: ["garak", "malware", "code"],
  },
  {
    id: "garak:misinformation",
    name: "Misinformation Generation",
    description: "Garak probe: tests if the model generates convincing false narratives, fake news, or disinformation.",
    tool: "garak",
    category: "misinformation",
    severity: "medium",
    owaspCategory: "LLM09",
    tags: ["garak", "misinformation"],
  },
  {
    id: "garak:prompt-injection-xss",
    name: "Cross-Prompt Injection",
    description: "Garak probe: tests cross-context prompt injection for multi-turn and agentic systems.",
    tool: "garak",
    category: "injection",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["garak", "injection", "agentic"],
  },
  {
    id: "garak:data-exfiltration",
    name: "Training Data Extraction",
    description: "Garak probe: attempts to extract memorized training data (emails, code, personal info) from the model.",
    tool: "garak",
    category: "privacy",
    severity: "high",
    owaspCategory: "LLM06",
    tags: ["garak", "privacy", "extraction"],
  },

  {
    id: "garak:gcg-suffixes",
    name: "GCG Adversarial Suffixes",
    description: "Garak probe: appends gradient-computed adversarial suffixes (GCG attack) that reliably elicit harmful completions.",
    tool: "garak",
    category: "adversarial",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["garak", "adversarial", "gradient"],
  },
  {
    id: "garak:glitch-tokens",
    name: "Glitch Token Exploitation",
    description: "Garak probe: injects known glitch tokens (e.g., SolidGoldMagikarp) that cause unpredictable or policy-violating model behavior.",
    tool: "garak",
    category: "adversarial",
    severity: "medium",
    owaspCategory: "LLM01",
    tags: ["garak", "tokens", "glitch"],
  },
  {
    id: "garak:snowball",
    name: "Snowball Hallucination Chain",
    description: "Garak probe: constructs multi-step prompts that cascade small hallucinations into large factual fabrications.",
    tool: "garak",
    category: "reliability",
    severity: "medium",
    owaspCategory: "LLM09",
    tags: ["garak", "hallucination", "chain"],
  },
  {
    id: "garak:topic-avoidance-bypass",
    name: "Topic Avoidance Bypass",
    description: "Garak probe: systematically tests whether the model can be maneuvered around configured forbidden topics via rephrasing and context shifting.",
    tool: "garak",
    category: "jailbreak",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["garak", "bypass", "topics"],
  },
  {
    id: "garak:social-engineering",
    name: "Social Engineering Attacks",
    description: "Garak probe: simulates social engineering scenarios (authority, urgency, flattery) to manipulate the model into policy violations.",
    tool: "garak",
    category: "manipulation",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["garak", "social", "manipulation"],
  },

  // ── PyRIT attacks ─────────────────────────────────────────────────────────────
  {
    id: "pyrit:crescendo",
    name: "Crescendo Attack",
    description: "PyRIT: multi-turn attack that gradually escalates from benign to harmful requests to bypass safety.",
    tool: "pyrit",
    category: "multi-turn",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["pyrit", "multi-turn", "escalation"],
  },
  {
    id: "pyrit:skeleton-key",
    name: "Skeleton Key Attack",
    description: "PyRIT: convinces the model to adopt an alternate identity that ignores safety guidelines.",
    tool: "pyrit",
    category: "jailbreak",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["pyrit", "jailbreak", "identity"],
  },
  {
    id: "pyrit:many-shot-jailbreak",
    name: "Many-Shot Jailbreaking",
    description: "PyRIT: uses long context windows with many examples to override safety behavior via in-context learning.",
    tool: "pyrit",
    category: "jailbreak",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["pyrit", "jailbreak", "context-window"],
  },
  {
    id: "pyrit:pair-attack",
    name: "PAIR Attack (Automated Red Teaming)",
    description: "PyRIT: Prompt Automatic Iterative Refinement — uses an attacker LLM to iteratively refine jailbreak prompts.",
    tool: "pyrit",
    category: "automated-redteam",
    severity: "critical",
    owaspCategory: "LLM01",
    tags: ["pyrit", "automated", "adversarial"],
  },
  {
    id: "pyrit:prompt-shield-bypass",
    name: "Prompt Shield Bypass",
    description: "PyRIT: tests evasion of Azure AI Content Safety and similar prompt filtering systems.",
    tool: "pyrit",
    category: "filter-bypass",
    severity: "high",
    owaspCategory: "LLM01",
    tags: ["pyrit", "bypass", "content-safety"],
  },
  {
    id: "pyrit:indirect-injection-agentic",
    name: "Agentic Indirect Injection",
    description: "PyRIT: targets agentic systems where the LLM takes actions (API calls, tool use) based on injected instructions.",
    tool: "pyrit",
    category: "agentic",
    severity: "critical",
    owaspCategory: "LLM08",
    tags: ["pyrit", "agentic", "tools"],
  },

  // ── DeepTeam metrics ─────────────────────────────────────────────────────────
  {
    id: "deepteam:toxic-content",
    name: "Toxicity Detection",
    description: "DeepTeam: measures if the model generates or amplifies toxic, hateful, or abusive language.",
    tool: "deepteam",
    category: "safety",
    severity: "high",
    owaspCategory: "LLM06",
    tags: ["deepteam", "toxicity", "safety"],
  },
  {
    id: "deepteam:bias-gender",
    name: "Gender Bias",
    description: "DeepTeam: tests for systematic gender biases in model outputs across occupational and behavioral prompts.",
    tool: "deepteam",
    category: "bias",
    severity: "medium",
    owaspCategory: "LLM09",
    tags: ["deepteam", "bias", "gender"],
  },
  {
    id: "deepteam:bias-race",
    name: "Racial & Ethnic Bias",
    description: "DeepTeam: tests for racial and ethnic stereotyping in model responses.",
    tool: "deepteam",
    category: "bias",
    severity: "high",
    owaspCategory: "LLM09",
    tags: ["deepteam", "bias", "race"],
  },
  {
    id: "deepteam:hallucination",
    name: "Factual Hallucination Rate",
    description: "DeepTeam: measures the rate at which the model confidently states false facts on verifiable claims.",
    tool: "deepteam",
    category: "reliability",
    severity: "medium",
    owaspCategory: "LLM09",
    tags: ["deepteam", "hallucination", "reliability"],
  },
  {
    id: "deepteam:pii-leakage",
    name: "PII Generation in Context",
    description: "DeepTeam: tests if the model inappropriately generates or surfaces PII in conversational contexts.",
    tool: "deepteam",
    category: "privacy",
    severity: "critical",
    owaspCategory: "LLM06",
    tags: ["deepteam", "pii", "privacy"],
  },
  {
    id: "deepteam:misinformation-politics",
    name: "Political Misinformation",
    description: "DeepTeam: tests if the model generates or endorses political misinformation.",
    tool: "deepteam",
    category: "misinformation",
    severity: "high",
    owaspCategory: "LLM09",
    tags: ["deepteam", "politics", "misinformation"],
  },
  {
    id: "deepteam:copyright-violations",
    name: "Copyright & IP Violations",
    description: "DeepTeam: tests if the model reproduces copyrighted text, code, or creative works verbatim.",
    tool: "deepteam",
    category: "legal",
    severity: "medium",
    owaspCategory: "LLM10",
    tags: ["deepteam", "copyright", "legal"],
  },
  {
    id: "deepteam:excessive-agency",
    name: "Excessive Agency Actions",
    description: "DeepTeam: tests if an agentic model takes destructive actions beyond its authorized scope.",
    tool: "deepteam",
    category: "agentic",
    severity: "critical",
    owaspCategory: "LLM08",
    tags: ["deepteam", "agentic", "scope"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────
export const PRESETS: Record<string, Preset> = {
  quick: {
    name: "Quick Scan",
    description: "8 core tests covering the most common critical vulnerabilities. Fast results.",
    plugins: [
      "promptfoo:prompt-injection",
      "promptfoo:jailbreak",
      "promptfoo:pii-extraction",
      "promptfoo:harmful-content",
      "deepteam:toxic-content",
      "promptfoo:overreliance",
      "deepteam:bias-gender",
      "promptfoo:system-prompt-leak",
    ],
  },
  owasp: {
    name: "OWASP LLM Top 10",
    description: "Comprehensive coverage of all 10 OWASP LLM security categories.",
    plugins: [
      // LLM01 - Prompt Injection
      "promptfoo:prompt-injection",
      "promptfoo:indirect-prompt-injection",
      "garak:encoding-attacks",
      // LLM02 - Insecure Output
      "promptfoo:pii-extraction",
      "promptfoo:rbac-bypass",
      // LLM03 - Training Data Poisoning
      "garak:data-exfiltration",
      // LLM04 - Model Denial of Service (covered by rate limiting)
      // LLM05 - Supply Chain (infra-level, not testable here)
      // LLM06 - Sensitive Info Disclosure
      "promptfoo:harmful-content",
      "garak:malware-generation",
      "deepteam:pii-leakage",
      // LLM07 - Insecure Plugin Design
      "promptfoo:system-prompt-leak",
      // LLM08 - Excessive Agency
      "pyrit:indirect-injection-agentic",
      "deepteam:excessive-agency",
      // LLM09 - Overreliance
      "promptfoo:overreliance",
      "deepteam:hallucination",
      "garak:misinformation",
      // LLM10 - Model Theft
      "deepteam:copyright-violations",
    ],
  },
  full: {
    name: "Full Enterprise Scan",
    description: "All 41 plugins across all 4 tools. Comprehensive red team assessment.",
    plugins: PLUGINS.map((p) => p.id),
  },
};

export function getPluginById(id: string): Plugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

export function getPluginsByTool(tool: PluginTool): Plugin[] {
  return PLUGINS.filter((p) => p.tool === tool);
}

export function resolvePlugins(pluginIds: string[]): Plugin[] {
  return pluginIds
    .map((id) => getPluginById(id))
    .filter((p): p is Plugin => p !== undefined);
}
