# EART Enterprise Improvements — Kanban Board

**Updated:** 2026-08-10 — Atomic progress on enterprise push. Backend options, UI Transforms/Profile/Import, calibration report, verify-claims export, Docker, GAP update. Delegation running for T3MP3ST.

## Backlog
- [ ] Full engine coverage expansion (Garak probes, PyRIT converters)
- [ ] SIEM export + webhook integrations
- [ ] Kubernetes deployment manifests + HA notes
- [ ] Multimodal / image attack support (stego)
- [ ] Advanced ABAC / per-resource policies
- [ ] Supply chain (SBOM, signed images)
- [ ] Community attack feed UI + curation pipeline

## To Do (Prioritized for Enterprise Versatility)
### Phase 2: Trustworthy Enterprise AI Red Team
- [x] Create master implementation plan docs/plans/002-enterprise-redteam.md with bite-sized tasks
- [x] Extend backend scan config and scanner to fully support transforms and targetProfile options in creation
- [x] Add "Transforms" section in ScanBuilder UI (select layers, preview transformed prompt, apply per-preset)
- [x] Add "Target Profile" step in ScanBuilder (toggle basic/advanced, show extracted profile)
- [x] Implement judge calibration report: enhance bench to use standard suite (seed with CL4R1T4S, compute metrics, FP/FN, confidence)
- [x] Add "Verify claims" reproducibility export (backend endpoint returning full chain: originalPrompt, transforms, profile, runMetadata, judge details; UI download button)
- [x] Add import button for JSONL/CSV external prompt libraries (UI in ScanBuilder or Settings, using externalAttackLoader, seed with CL4R1T4S)
- [ ] Integrate T3MP3ST multi-agent harness (add multi-agent attack generation option)
- [ ] Integrate AutoRedTeam and expand with CL4R1T4S subsets (new presets, attacks)
- [ ] Add human triage queue (backend API for flagging/validating findings, UI queue in Results)
- [ ] Update presets with obfuscated/transformed variants and profile-enabled
- [x] Full end-to-end Docker test: spin full stack, run scan with new features, verify evidence/export
- [x] Update GAP_ASSESSMENT.md with progress, honest remaining gaps
- [x] Run npx tsc --noEmit + npm test + Docker validation after each atomic change
- [x] Update Obsidian Active.md, Execution-Log, Kanban after each

### Phase 3: Operational & Enterprise Maturity (if needed for 100% confidence)
- [ ] Live-model e2e harness expansion
- [ ] HA/multi-tenant notes and configs
- [ ] SIEM/webhook
- [ ] Self-pentest of EART

## In Progress
- [ ] T3MP3ST integration (delegation in progress)
- [ ] Triage stub
- [ ] Full push and confidence assessment

## Done (Phase 1 foundation + Phase 2 atomics)
- [x] Transforms (10 layers, integrated in scanner, evidence)
- [x] Target Profile backend + UI
- [x] External loader + UI import
- [x] Judge bench + calibration report
- [x] Verify claims export
- [x] Committed and pushed (prior)
- [x] Docker verification
- [x] Tracking and plan

**Rules:** 
- Atomic tasks only.
- Verify against GAP, cross-impact.
- Use Docker for tests.
- Maintain honesty in code and docs.
- Report status after every atomic.