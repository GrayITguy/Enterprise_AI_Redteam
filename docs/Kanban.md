# EART Enterprise Improvements — Kanban Board

**Updated:** 2026-08-10 — Core Phase 1 complete: Transforms, Judge bench, Target Profile, External loader. All verified. 

## Backlog
- [ ] Full engine coverage expansion (Garak probes, PyRIT converters)
- [ ] SIEM export + webhook integrations
- [ ] Kubernetes deployment manifests + HA notes
- [ ] Multimodal / image attack support (stego)
- [ ] Advanced ABAC / per-resource policies
- [ ] Full live-model e2e benchmark harness in CI (beyond smoke)
- [ ] Supply chain (SBOM, signed images)
- [ ] Community attack feed UI + curation pipeline

## To Do (Prioritized)
### Phase 1: Trust & Basics
- [x] Transforms skeleton + tests (P4RS3LT0NGV3)
- [x] Integrate transforms into promptfoo attack paths (scanner)
- [x] Expand transforms (urlEncode, whitespaceStego, fullWidth + more)
- [x] Record appliedTransforms in evidence + runMetadata
- [x] Judge benchmarking scaffold + sample run (functional with metrics)
- [x] Target Profile step (system prompt extraction + storage in metadata)
- [x] Import for external libs (CL4R1T4S subsets as JSONL)
- [ ] Reproducibility receipts (export endpoint/script - foundation in metadata)
- [ ] Human triage queue stub
- [ ] Update presets with obfuscated examples + profile toggle

### Phase 2+
 (unchanged from previous)

## In Progress
- [ ] Polish: presets, frontend toggle, full bench with real target, Docker full app spin

## Done
- [x] Workspace, tracking, Docker Redis test
- [x] Transforms + full integration in scanner (221 tests pass)
- [x] Demo attacks using transforms
- [x] Evidence enhancement for transforms
- [x] Judge bench functional
- [x] Target Profile backend
- [x] External attack import loader

**Rules:** Atomic tasks, verify GAP + tests after changes, update after each.
