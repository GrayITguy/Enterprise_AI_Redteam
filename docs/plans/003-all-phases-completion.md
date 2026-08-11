# EART — All Phases Completion Plan (2026-08-10)

**Objective:** Complete every phase from the master plan (0-6) and Kanban Phase 2/3 items until the platform meets enterprise AI red team needs with 100% confidence. No half measures. Do not stop until all verified.

**Current Baseline (verified 2026-08-10):**
- Phase 0: Complete
- Phase 1: Backend (transforms, profile, loader) — Complete
- Phase 2: UI (ScanBuilder extensions) — Complete
- Phase 3: Calibration, verify-claims, import — Complete (with recent triage enhancement to export)
- Phase 4: T3MP3ST (playbook + decompose stubs) — Partial (stubs exist, full integration missing)
- Phase 5: Triage — Backend + UI stub complete; presets expansion missing
- Phase 6: Verification — Tests green, Docker partial; full E2E + push + final docs missing

**Open Items (from Kanban + plan):**
- Update presets with obfuscated/transformed + pliny variants
- Full T3MP3ST decompose/swarm integration in scanner
- Full Docker E2E spin + test scan exercising all new features (pliny, transforms, profile, triage, export)
- Update GAP with final status
- Commit/push + tracking updates
- Polish (if time): basic swarm, more presets

**Execution Protocol (strict):**
- Atomic tasks only (2-10 min each).
- After EVERY edit: npx tsc --noEmit && npm test -- --run && docker compose --env-file .env.test config --quiet
- Update Execution-Log.md, Kanban.md, Obsidian Active.md after each.
- Use Docker for test instances.
- Report: done → result (with command output) → next.
- Position honestly: aggregator with powerful layers + audit.

**Detailed Atomic Tasks to Completion**

### Phase 4 Completion
**Atomic 4.1:** Integrate decompose into scanner run loop for pliny preset.
- Files: src/server/services/scanner.ts (use attackTransformer.decomposeAndTransform when usePliny)
- Verify: tsc + test

**Atomic 4.2:** Add pliny-advanced and pliny-decompose presets.
- Files: src/server/config/pluginCatalog.ts (add to presets)
- Verify

### Phase 5 Completion
**Atomic 5.1:** Expand presets with transformed/profile/pliny variants.
- Add 3-4 new presets using options.
- Update attackPatterns demos if needed.
- Verify

**Atomic 5.2:** Enhance triage UI (status in list, basic action).
- Improve Results.tsx FindingRow or add simple queue note.
- Verify (frontend type check if possible)

### Phase 6 Completion
**Atomic 6.1:** Full Docker E2E.
- Spin full stack (app, redis, proxy).
- Use tsx or curl to create project + scan with pliny + transforms.
- Run scan, check evidence, call verify-claims, update triage.
- Down after.
- Verify output shows new features.

**Atomic 6.2:** Final GAP, logs, push.
- Append final update to ENTERPRISE_GAP_ASSESSMENT.md
- Update Execution-Log, Kanban, Obsidian with "ALL PHASES COMPLETE"
- git add, commit, push
- Final tsc + test + docker config

**Success Criteria:**
- All tasks above checked [x] in this plan + Kanban.
- 221/221 tests, clean tsc, Docker E2E passes with new features.
- Expert confidence: "This is a strong, auditable aggregator with advanced red team techniques."

**Start Execution Now.** Report status after each atomic. Continue until done.
