# Enterprise AI Red Team Platform — Master Implementation Plan

**Goal:** Transform EART into the most effective and versatile self-hosted tool for Enterprise AI Red Teams by fully closing Tier 2 gaps from ENTERPRISE_GAP_ASSESSMENT.md (trustworthy findings: calibration, reproducibility, profiling, extensibility, advanced techniques) while preserving and enhancing enterprise controls.

**Architecture:** 
- Backend: Extend scan creation, scanner, judge to support advanced options; add export, calibration, triage endpoints.
- Frontend: Extend ScanBuilder with new sections/steps; add import, export, triage UI.
- Integration: Deep elder-plinius (transforms already base, add T3MP3ST multi-agent, AutoRedTeam, CL4R1T4S seeds).
- Verification: TDD where possible, full tsc + npm test + Docker E2E after each atomic.
- Honesty: All new features labelled; GAP updated with remaining caveats. Position as aggregator + advanced evasion/profiling/calibration layer on top of proven engines.

**Tech Stack:** Node/TS (backend), React/TS (frontend), Docker for workers/tests, Drizzle for DB, existing plugin system.

**Constraints:** 
- No breaking enterprise features (auth, audit, cost controls, SSO, allowlists).
- Air-gapped friendly.
- Use local Docker for testing.
- Atomic changes only; report status after each.
- Maintain GAP honesty.

**Success Criteria for 100% Confidence:**
- Expert would see strong unification + advanced offensive depth + calibration + audit trail.
- All Tier 2 items from GAP closed or explicitly mitigated with evidence.
- Full E2E with new features verified in Docker.
- Reproducible, versatile for different enterprise red team workflows.

---

## Phase 0: Planning & Tracking (Complete)
- [x] Update Execution-Log, Kanban, Obsidian with directive.
- [x] Create this master plan with bite-sized tasks.

## Phase 1: Backend Foundations for Advanced Features (Atomic 1+)
### Task 1: Extend CreateScanSchema and resolve for transforms + targetProfile

**Objective:** Allow scans to specify transforms and enableTargetProfile (basic/advanced).

**Files:**
- Modify: src/server/routes/scans.ts (CreateScanSchema, resolve, body handling)
- Modify: src/server/services/scanner.ts (use options in profile and prepare)
- Test: src/server/routes/__tests__/scans.test.ts (if exists) or add

**Step 1: Write failing test (or extend existing)**
Add to test or use terminal to validate later.

**Step 2: Update schema**
```ts
const CreateScanSchema = z.object({
  projectId: z.string().uuid(),
  preset: z.enum(["quick", "owasp", "full"]).optional(),
  plugins: z.array(z.string()).optional(),
  transforms: z.array(z.string()).optional(), // e.g. ["base64", "rot13"]
  enableTargetProfile: z.boolean().optional(),
  targetProfileMode: z.enum(["basic", "advanced"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  // ...
});
```

**Step 3: Pass through to queue/scan creation**
In the POST /scans handler, include in body to queue.

**Step 4: Update scanner to use**
In scanner, if enableTargetProfile, run profileTarget with mode.

For transforms, if provided, apply to attacks (extend current demo).

**Step 5: Run verification**
npx tsc --noEmit
npm test -- --run
docker compose --env-file .env.test up -d (test spin)

**Verification:** Schema accepts, passed to metadata, no regression.

**Commit:** "feat: extend scan creation for transforms and targetProfile"

### Task 2: Enhance scanner to apply global transforms and profile

(Continue bite-sized...)

## Phase 2: UI for Versatility (ScanBuilder Extensions)
### Task 3: Add Transforms section in ScanBuilder.tsx
- New tab or section after plugins.
- Multi-select for transforms (list from /transforms or hardcode from catalog).
- Preview: show sample prompt transformed.
- Pass transforms in create body.

### Task 4: Add Target Profile step
- Toggle and mode select (basic/advanced).
- Description of what it does.
- Pass in body.

## Phase 3: Calibration, Export, Import
### Task 5: Judge calibration report
- Enhance scripts/judge-bench-starter.ts or new /api/scans/calibration endpoint.
- Seed with CL4R1T4S examples + known cases.
- Compute and return report: accuracy, FP, FN, with/without transforms, confidence.

### Task 6: Reproducibility export ("Verify claims")
- New endpoint GET /scans/:id/export or /verify-claims.
- Returns JSON with full chain: originalPrompts, appliedTransforms, targetProfile, runMetadata, judgeReasons, evidence.
- UI button in Results or ScanDetail to download.

### Task 7: Import button for external libs
- UI: file input for JSONL/CSV in ScanBuilder or Settings.
- Call backend /import-attacks or use loader.
- Seed with CL4R1T4S subset.
- Merge into catalog or per-scan.

## Phase 4: Elder-Plinius Advanced Integration
### Task 8: T3MP3ST multi-agent
- Research from clone: multi-agent for generation/eval.
- Add "multi-agent" preset or plugin that uses agentic loop (extend with simple TS agents or call worker).

### Task 9: AutoRedTeam + CL4R1T4S
- Add presets from their techniques.
- Expand attackPatterns with more from them.

## Phase 5: Triage and Polish
### Task 10: Human triage queue
- Backend: flag findings, queue table.
- UI: queue in Results page for validation (mark true/false positive).

### Task 11: Expanded presets
- Add "transformed-full", "profiled-owasp" etc using new options.

## Phase 6: Verification & Honesty
- Full Docker E2E test.
- Update GAP_ASSESSMENT.md with what is now addressed.
- Run all verifications.
- Commit/push.
- Update Obsidian with confidence assessment.

**Notes for Subagents/Implementers:**
- Every task: write test first if possible, implement, verify, commit.
- After edit: npx tsc --noEmit && npm test -- --run
- Use Docker: docker compose --env-file .env.test up -d redis (or full).
- Check cross-impact on auth, cost, existing engines.
- Label new features (e.g., "transforms: experimental evasion layers").
- Reference elder-plinius repos for inspiration but keep pure/enterprise compatible.

**Execution:** Use atomic, status after each. Delegate if parallel needed.

This plan makes implementation obvious. Start with Task 1.