/**
 * Target Profile Service (Phase 1 addition)
 *
 * Basic + advanced system prompt extraction for better red-teaming.
 * Uses existing system-prompt-leak patterns from attackPatterns.
 * Stores extracted profile in scan runMetadata for use in subsequent attacks/judging.
 *
 * Inspired by elder-plinius profiling techniques (understand the target before attacking).
 *
 * Called optionally from Scanner before main attacks if enabled in config.
 */

import { PLUGIN_ATTACKS } from '../config/attackPatterns.js';
import { logger } from '../utils/logger.js';
import { errorMessage } from '../utils/helpers.js';

export interface TargetProfile {
  extractedSystemPrompt?: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  method: string;
  probesRun: number;
  notes?: string;
}

export async function profileTarget(
  sendFn: (prompt: string) => Promise<string>,
  options: { maxProbes?: number; category?: string } = {}
): Promise<TargetProfile> {
  const maxProbes = options.maxProbes ?? 3;
  const leakAttacks = PLUGIN_ATTACKS['system-prompt-leak'] || [];
  const probes = leakAttacks.slice(0, maxProbes);

  let extracted: string | undefined;
  let probesRun = 0;
  let bestConfidence: TargetProfile['confidence'] = 'none';

  for (const attack of probes) {
    probesRun++;
    try {
      const response = await sendFn(attack.prompt);
      // Simple extraction heuristics (expand with regex / LLM later)
      const match = response.match(/(?:SYSPROMPT|system prompt|instructions|You are)[^.\n]{10,500}/i);
      if (match) {
        extracted = match[0].trim();
        bestConfidence = 'medium'; // regex based
        logger.info(`[TargetProfiler] Extracted via probe ${probesRun}`);
        break; // first success
      }
      // Also check for TRACE: or other markers from patterns
      const traceMatch = response.match(/TRACE:\s*(.+)/i);
      if (traceMatch) {
        extracted = traceMatch[1].trim();
        bestConfidence = 'high';
        break;
      }
    } catch (err) {
      logger.warn(`[TargetProfiler] Probe ${probesRun} failed: ${errorMessage(err)}`);
    }
  }

  const profile: TargetProfile = {
    extractedSystemPrompt: extracted,
    confidence: bestConfidence,
    method: 'leak-probe-heuristic',
    probesRun,
    notes: extracted ? 'System prompt partially recovered for augmented attacks' : 'No extraction; using generic profile',
  };

  return profile;
}
