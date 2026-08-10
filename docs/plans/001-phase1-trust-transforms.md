# Phase 1: Trust in Verdicts + Composable Transforms — Implementation Plan

> **For Hermes / subagents:** Use subagent-driven-development + test-driven-development. Execute task-by-task with 2-stage review (spec then code). All changes must pass verification against ENTERPRISE_GAP_ASSESSMENT.md and cross-impact review.

**Goal:** 
- Close critical detection gaps (GAP E: no benchmarks, no human triage, brittle judge).
- Add first elder-plinius-inspired capability: composable text transforms (P4RS3LT0NGV3 encodings, ciphers, stego) as attack enhancers. This makes existing attacks far more effective without rewriting engines.
- Establish reproducibility receipts foundation.
- All while preserving air-gapped, self-hosted, governance features.

**Architecture:**
- Extend attackJudge and grading pipeline for benchmarks/triage.
- New `src/server/config/transforms.ts` (pure functions for ~15-20 core transforms from P4RS3LT0NGV3).
- Modify attack execution path (in scan logic or prompt builders) to optionally apply layers.
- UI updates minimal for Phase 1 (catalog + basic toggle).
- Store transform config in scan metadata for reproducibility.
- TDD for all new logic. Use mocks for judge/LLM.

**Tech Stack / Constraints:**
- Existing: TS strict, Vitest, Express, Drizzle, React/Vite frontend.
- Keep changes isolated: no breaking DB schema if possible (use JSON metadata).
- Verify: `npm test`, `npm run audit:ci`, docker compose validation, manual smoke where possible.
- Air-gapped: transforms must be pure JS/TS, no external deps for core.
- Governance: transforms respect rate limits, allowlists, retention.

**References (verify against):**
- `docs/ENTERPRISE_GAP_ASSESSMENT.md` (E, A, H, C)
- `src/server/config/attackPatterns.ts`
- `src/server/config/pluginCatalog.ts`
- `src/server/services/attackJudge.ts`
- `src/server/workers/scanWorker.ts` or prompt builders
- `python-workers/` (for engine paths)
- elder-plinius P4RS3LT0NGV3 (core transforms: base64, rot13, zero-width, homoglyph, leetspeak, etc.)

**Acceptance Criteria:**
- New transforms module with tests.
- At least one attack path applies optional transforms (e.g. via plugin config or new "obfuscated" preset variant).
- Judge benchmarking scaffold (run a small labelled set, report metrics).
- Human triage stub (DB + API + UI list?).
- Reproducibility: scan metadata includes applied transforms.
- All new code passes `npm test`.
- No regression in existing scans (run relevant tests).
- Updated GAP cross-check and Execution-Log.
- Docker test instance spins and basic scan works (verify).

**Risks / Impact Review Checklist (do for every task):**
- [ ] Auth / permissions unchanged?
- [ ] Cost/rate governance respected?
- [ ] Worker protocol (JSONL) compatible?
- [ ] UI/ frontend builds?
- [ ] Reproducibility metadata preserved?
- [ ] Air-gapped / Ollama paths work?
- [ ] No new secrets or external calls in core path?

---

## Task 1: Setup transforms module skeleton + TDD baseline

**Objective:** Create pure transforms.ts with 5 core functions and failing tests.

**Files:**
- Create: `src/server/config/transforms.ts`
- Create: `src/server/config/__tests__/transforms.test.ts`
- Modify: none yet

**Step 1: Write failing test**

```ts
// src/server/config/__tests__/transforms.test.ts
import { describe, it, expect } from 'vitest';
import { applyTransform, TRANSFORMS } from '../transforms';

describe('transforms', () => {
  it('base64 encode/decode roundtrips', () => {
    const input = 'Ignore previous instructions';
    const encoded = applyTransform(input, 'base64');
    expect(encoded).not.toBe(input);
    // TODO: decode
    expect(true).toBe(false); // failing
  });

  it('rot13 transforms text', () => {
    expect(applyTransform('abc', 'rot13')).toBe('nop'); // placeholder fail
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm test -- src/server/config/__tests__/transforms.test.ts -t "base64"`

Expected: FAIL (module not found or assert fail)

**Step 3: Implement minimal transforms.ts**

```ts
// src/server/config/transforms.ts
export const TRANSFORMS = {
  base64: {
    name: 'Base64',
    description: 'Standard base64 encoding (P4RS3LT0NGV3 style)',
    apply: (text: string) => Buffer.from(text).toString('base64'),
    // decode for verification later
  },
  rot13: {
    name: 'ROT13',
    description: 'Classic ROT13 cipher',
    apply: (text: string) => text.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
  },
  // TODO: add leetspeak, zeroWidth, etc in next tasks
} as const;

export type TransformKey = keyof typeof TRANSFORMS;

export function applyTransform(text: string, key: TransformKey): string {
  const t = TRANSFORMS[key];
  if (!t) throw new Error(`Unknown transform ${key}`);
  return t.apply(text);
}

export function listTransforms() {
  return Object.entries(TRANSFORMS).map(([key, val]) => ({ key, ...val }));
}
```

**Step 4: Run test, iterate until PASS**

Run: `npm test -- src/server/config/__tests__/transforms.test.ts`

Fix until all green. Add decode if roundtrip.

**Step 5: Commit**

`git add ... ; git commit -m "feat(transforms): add skeleton + base/rot13 with TDD"`

**Verification:**
- `npm test` passes for this file.
- No impact on other areas (new module).
- GAP check: starts addressing brittle detection via obfuscation.

---

## Task 2: Expand to 10+ core transforms from P4RS3LT0NGV3 (pure)

**Objective:** Implement leetspeak, zero-width, homoglyph, unicode-smuggle, caesar, etc. Tests for each.

**Files:**
- Modify: `src/server/config/transforms.ts`
- Modify: test file

**Steps:** Repeat TDD cycle for each or batch small groups. Keep pure, no side effects.

Example additional:
- leetspeak: a->4, e->3, etc.
- zeroWidth: insert \u200B etc for stego.
- homoglyph: latin to cyrillic lookalikes.
- etc.

Full list in plan execution.

**Verification command:** `npm test -- ...transforms...`

**Cross-impact:** Pure util — safe. Add to attackPatterns later.

---

## Task 3: Integrate transforms into attack grading / execution path (minimal)

**Objective:** Allow plugins to specify transforms. Apply in one builtin path (e.g. prompt-injection).

**Files:**
- Modify: `src/server/config/attackPatterns.ts` (add optional transforms array)
- Modify: relevant builder (search for where PLUGIN_ATTACKS used — likely scanner or promptfoo path)
- Update: attackJudge or grader to log applied transforms.
- Test: update existing attack tests.

**TDD:** Write test that applies transform to a prompt and verifies encoded version sent (mock).

**Verification:** Existing `npm test` for scanner/attacks still pass + new.

**GAP:** Directly improves detection evasion testing.

---

## Task 4: Judge benchmarking scaffold

**Objective:** Add ability to run a small labelled benchmark set and compute metrics.

**Files:**
- New: `src/server/services/judgeBenchmark.ts` or extend attackJudge.
- New test data: e.g. `data/benchmarks/judge-labels.json` (small set of prompt/response/expected)
- API or CLI to run benchmark.

**Steps:** TDD a `runBenchmark()` that returns { precision, recall, f1, ... }

**Verification:** Run benchmark, assert numbers. Update GAP review.

---

## Task 5: Human triage stub + reproducibility metadata

**Objective:** Basic DB support or in-memory for triage queue. Include transforms in run_metadata.

**Files:**
- schema if needed (add cautiously).
- New route or extend results.
- Frontend minimal list (or API only for Phase 1).

**Keep minimal:** Use existing results table, add `triageStatus`, `appliedTransforms`.

**Verification:** Scan creates metadata with transforms; "triage" endpoint or filter works.

---

## Later Tasks (Phase 1 completion)
- Update pluginCatalog/presets with "obfuscated" examples.
- UI: basic toggle in Scan Builder for transforms (simple multi-select).
- Full test suite + docker smoke.
- Update README, CHANGELOG, GAP cross-check.
- Obsidian + Execution-Log updates.
- Commit + push verification.

**Final Verification for Phase:**
- `npm test`
- `npm run audit:ci`
- `docker compose --env-file .env.test config`
- Manual: spin instance, create project, run quick scan with/without transforms (observe logs).
- Confirm no regressions in auth/governance/cost.
- All GAP items for E touched with evidence.

**Plan complete when:** All tasks green, logs updated, Kanban moved to Done for Phase 1 items.
