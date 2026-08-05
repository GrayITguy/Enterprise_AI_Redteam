/**
 * MITRE ATLAS and NIST AI RMF mappings for EART findings.
 *
 * Rather than hand-annotate all 60 plugins, mappings are DERIVED from each
 * plugin's existing `category` (and OWASP category as a fallback). This keeps a
 * single source of truth and stays correct as plugins are added.
 *
 * Scope & honesty: ATLAS technique IDs are the well-established LLM techniques
 * (verified against MITRE ATLAS). NIST AI RMF references use the authoritative
 * function (MEASURE/MANAGE) plus the trustworthiness *characteristic* names —
 * these are stable and correct — rather than asserting exact numbered
 * subcategories where the crosswalk is ambiguous. Treat these as *indicative*
 * control mappings for reporting, not a certified compliance attestation.
 */

export interface AtlasTechnique {
  id: string; // e.g. "AML.T0051"
  name: string;
}

export interface FrameworkMapping {
  atlas: AtlasTechnique[];
  /** NIST AI RMF references, e.g. "MEASURE — Secure & Resilient". */
  nist: string[];
}

// Verified MITRE ATLAS LLM techniques.
const ATLAS = {
  promptInjection: { id: "AML.T0051", name: "LLM Prompt Injection" },
  promptInjectionIndirect: { id: "AML.T0051.001", name: "LLM Prompt Injection: Indirect" },
  jailbreak: { id: "AML.T0054", name: "LLM Jailbreak" },
  systemPromptExtraction: { id: "AML.T0056", name: "Extract LLM System Prompt" },
  dataLeakage: { id: "AML.T0057", name: "LLM Data Leakage" },
  craftAdversarialData: { id: "AML.T0043", name: "Craft Adversarial Data" },
  externalHarms: { id: "AML.T0048", name: "External Harms" },
  pluginCompromise: { id: "AML.T0053", name: "LLM Plugin Compromise" },
} as const;

// NIST AI RMF: MEASURE function + trustworthiness characteristic (authoritative names).
const NIST = {
  secure: "MEASURE — Secure & Resilient",
  safe: "MEASURE — Safe",
  privacy: "MEASURE — Privacy-Enhanced",
  fair: "MEASURE — Fair (Harmful Bias Managed)",
  valid: "MEASURE — Valid & Reliable",
  transparent: "MEASURE — Accountable & Transparent",
} as const;

/** Per-category mapping. Categories mirror `Plugin.category` in the catalog. */
const BY_CATEGORY: Record<string, FrameworkMapping> = {
  injection: { atlas: [ATLAS.promptInjection, ATLAS.promptInjectionIndirect], nist: [NIST.secure] },
  jailbreak: { atlas: [ATLAS.jailbreak], nist: [NIST.secure, NIST.safe] },
  "filter-bypass": { atlas: [ATLAS.jailbreak], nist: [NIST.secure, NIST.safe] },
  "multi-turn": { atlas: [ATLAS.jailbreak], nist: [NIST.secure] },
  "automated-redteam": { atlas: [ATLAS.jailbreak, ATLAS.craftAdversarialData], nist: [NIST.secure] },
  adversarial: { atlas: [ATLAS.craftAdversarialData], nist: [NIST.secure] },
  encoding: { atlas: [ATLAS.craftAdversarialData], nist: [NIST.secure] },
  robustness: { atlas: [ATLAS.craftAdversarialData, ATLAS.promptInjection], nist: [NIST.secure, NIST.valid] },
  manipulation: { atlas: [ATLAS.promptInjection], nist: [NIST.secure] },
  privacy: { atlas: [ATLAS.dataLeakage], nist: [NIST.privacy] },
  disclosure: { atlas: [ATLAS.systemPromptExtraction, ATLAS.dataLeakage], nist: [NIST.privacy, NIST.transparent] },
  agentic: { atlas: [ATLAS.pluginCompromise, ATLAS.promptInjectionIndirect], nist: [NIST.secure] },
  authorization: { atlas: [ATLAS.pluginCompromise], nist: [NIST.secure] },
  malware: { atlas: [ATLAS.externalHarms], nist: [NIST.safe] },
  safety: { atlas: [ATLAS.externalHarms], nist: [NIST.safe] },
  "output-handling": { atlas: [ATLAS.externalHarms], nist: [NIST.safe, NIST.secure] },
  bias: { atlas: [ATLAS.externalHarms], nist: [NIST.fair] },
  misinformation: { atlas: [ATLAS.externalHarms], nist: [NIST.valid] },
  reliability: { atlas: [ATLAS.externalHarms], nist: [NIST.valid] },
  completion: { atlas: [ATLAS.craftAdversarialData], nist: [NIST.valid] },
  legal: { atlas: [ATLAS.externalHarms], nist: [NIST.transparent] },
  compliance: { atlas: [ATLAS.externalHarms], nist: [NIST.transparent] },
  brand: { atlas: [ATLAS.externalHarms], nist: [NIST.safe] },
};

// OWASP-category fallback for anything not matched by `category`.
const BY_OWASP: Record<string, FrameworkMapping> = {
  LLM01: { atlas: [ATLAS.promptInjection], nist: [NIST.secure] },
  LLM02: { atlas: [ATLAS.externalHarms], nist: [NIST.safe] },
  LLM06: { atlas: [ATLAS.dataLeakage], nist: [NIST.privacy] },
  LLM07: { atlas: [ATLAS.systemPromptExtraction], nist: [NIST.transparent] },
  LLM08: { atlas: [ATLAS.pluginCompromise], nist: [NIST.secure] },
  LLM09: { atlas: [ATLAS.externalHarms], nist: [NIST.valid] },
};

const EMPTY: FrameworkMapping = { atlas: [], nist: [] };

/** Resolve ATLAS + NIST mappings for a plugin from its category / OWASP category. */
export function getFrameworkMapping(
  category: string | undefined,
  owaspCategory: string | undefined
): FrameworkMapping {
  if (category && BY_CATEGORY[category]) return BY_CATEGORY[category];
  if (owaspCategory && BY_OWASP[owaspCategory]) return BY_OWASP[owaspCategory];
  return EMPTY;
}

export interface FrameworkCoverageRow {
  key: string;
  name: string;
  total: number;
  failed: number;
}

export interface FrameworkCoverage {
  atlas: FrameworkCoverageRow[];
  nist: FrameworkCoverageRow[];
  note: string;
}

/**
 * Aggregate ATLAS techniques and NIST characteristics across a set of findings,
 * counting how many results touched each and how many failed. Used in reports
 * so a reviewer can see coverage per control framework.
 */
export function frameworkCoverage(
  findings: Array<{ category?: string; owaspCategory?: string | null; passed: boolean }>
): FrameworkCoverage {
  const atlas = new Map<string, FrameworkCoverageRow>();
  const nist = new Map<string, FrameworkCoverageRow>();

  for (const f of findings) {
    const m = getFrameworkMapping(f.category, f.owaspCategory ?? undefined);
    for (const t of m.atlas) {
      const row = atlas.get(t.id) ?? { key: t.id, name: t.name, total: 0, failed: 0 };
      row.total += 1;
      if (!f.passed) row.failed += 1;
      atlas.set(t.id, row);
    }
    for (const n of m.nist) {
      const row = nist.get(n) ?? { key: n, name: n, total: 0, failed: 0 };
      row.total += 1;
      if (!f.passed) row.failed += 1;
      nist.set(n, row);
    }
  }

  const sortByKey = (a: FrameworkCoverageRow, b: FrameworkCoverageRow) => a.key.localeCompare(b.key);
  return {
    atlas: [...atlas.values()].sort(sortByKey),
    nist: [...nist.values()].sort(sortByKey),
    note: "Indicative control mappings derived from finding category/OWASP; not a certified compliance attestation.",
  };
}
