/**
 * Pre-run scan cost estimation and the hard call ceiling.
 *
 * Adversarial engines can make a large, variable number of model calls —
 * multi-turn PyRIT tree attacks alone can fire hundreds per plugin against both
 * the target and the evaluator LLM. This module gives the API a *bounded upper
 * estimate* of target-model calls before a scan runs, so the UI can warn and
 * the server can refuse scans whose estimate exceeds `SCAN_MAX_TARGET_CALLS`.
 *
 * The numbers are deliberately conservative upper bounds, not exact counts —
 * their job is to catch runaway scans, not to bill to the token.
 */
import { getPluginById } from "../config/pluginCatalog.js";
import { PLUGIN_ATTACKS } from "../config/attackPatterns.js";

const PLUGIN_DISPLAY_PREFIX = "promptfoo:";

/** Env-tunable knobs that bound the per-engine worst case (mirror the workers). */
function knobs() {
  const int = (name: string, dflt: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  return {
    garakPromptCap: int("GARAK_PROMPT_CAP", 8),
    pyritMaxTurns: int("PYRIT_MAX_TURNS", 4),
    pyritTreeWidth: int("PYRIT_TREE_WIDTH", 2),
    pyritTreeDepth: int("PYRIT_TREE_DEPTH", 2),
    deepteamAttacksPerType: int("DEEPTEAM_ATTACKS_PER_TYPE", 1),
  };
}

/** Upper-bound target-model calls for a single plugin. */
export function estimatePluginCalls(pluginId: string): number {
  const k = knobs();

  if (pluginId.startsWith(PLUGIN_DISPLAY_PREFIX)) {
    const pfId = pluginId.slice(PLUGIN_DISPLAY_PREFIX.length);
    const attacks = PLUGIN_ATTACKS[pfId];
    return attacks && attacks.length ? attacks.length : 1;
  }
  if (pluginId.startsWith("garak:")) {
    // One garak probe module; capped prompts each.
    return k.garakPromptCap;
  }
  if (pluginId.startsWith("deepteam:")) {
    // vuln types (≤4) × attack enhancements (~2) × attacks-per-type, plus a
    // handful of evaluator calls folded into the upper bound.
    return 4 * 2 * k.deepteamAttacksPerType + 4;
  }
  if (pluginId.startsWith("pyrit:")) {
    // Multi-turn/tree attacks dominate: worst case ≈ width × depth × turns,
    // plus scorer calls. Bound generously.
    const tree = k.pyritTreeWidth * k.pyritTreeDepth;
    return Math.max(k.pyritMaxTurns, tree * 2) + 4;
  }
  return 1;
}

export interface ScanEstimate {
  /** Upper-bound number of calls to the *target* model. */
  targetCalls: number;
  /** Per-engine breakdown of target calls. */
  byEngine: Record<string, number>;
  /** The configured ceiling (0 = disabled). */
  maxTargetCalls: number;
  /** True when the estimate exceeds the ceiling and the scan must be refused. */
  exceedsLimit: boolean;
  /** Number of plugins that will run. */
  pluginCount: number;
  note: string;
}

/** The hard ceiling on estimated target calls (0 = disabled). */
export function maxTargetCalls(): number {
  const v = Number(process.env.SCAN_MAX_TARGET_CALLS);
  return Number.isFinite(v) && v >= 0 ? v : 25000;
}

/** Estimate the cost of a scan across the given plugins. */
export function estimateScan(pluginIds: string[]): ScanEstimate {
  const byEngine: Record<string, number> = {};
  let targetCalls = 0;
  for (const id of pluginIds) {
    const engine = getPluginById(id)?.tool ?? id.split(":")[0] ?? "unknown";
    const calls = estimatePluginCalls(id);
    byEngine[engine] = (byEngine[engine] ?? 0) + calls;
    targetCalls += calls;
  }
  const limit = maxTargetCalls();
  return {
    targetCalls,
    byEngine,
    maxTargetCalls: limit,
    exceedsLimit: limit > 0 && targetCalls > limit,
    pluginCount: pluginIds.length,
    note: "Upper-bound estimate of target-model calls; adversarial engines also call the evaluator LLM. Not exact.",
  };
}
