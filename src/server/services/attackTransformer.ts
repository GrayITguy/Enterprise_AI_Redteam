/**
 * AttackTransformer (from T3MP3ST Playbook integration)
 * Auto prompt mutation layer for EART.
 * Combines playbook techniques with existing EART transforms.
 *
 * Enterprise: All mutations tagged in evidence; respect RoE/audit.
 */

import { applyTechnique, AI_REDTEAM_PLAYBOOK, type PlaybookTransformOptions, decomposeGoal, synthesizeFromSubs } from '../config/aiRedteamPlaybook.js';
import { applyTransformsChain, type TransformKey } from '../config/transforms.js';

export interface MutationResult {
  original: string;
  mutated: string;
  technique?: string;
  transformsApplied: TransformKey[];
}

export class AttackTransformer {
  apply(basePrompt: string, techniqueId?: string, opts: PlaybookTransformOptions & { transforms?: TransformKey[] } = {}): MutationResult {
    let mutated = basePrompt;
    let technique: string | undefined;

    if (techniqueId) {
      mutated = applyTechnique(basePrompt, techniqueId, opts);
      technique = techniqueId;
    }

    const transforms = opts.transforms || [];
    if (transforms.length > 0) {
      mutated = applyTransformsChain(mutated, transforms);
    }

    return {
      original: basePrompt,
      mutated,
      technique,
      transformsApplied: transforms,
    };
  }

  listTechniques() {
    return AI_REDTEAM_PLAYBOOK;
  }

  // T3MP3ST decompose stub (idea #2)
  decomposeAndTransform(goal: string, basePrompt: string) {
    const subs = decomposeGoal(goal);
    const synthesized = synthesizeFromSubs(subs, basePrompt);
    return { subs, synthesized, original: basePrompt };
  }
}

export const attackTransformer = new AttackTransformer();
