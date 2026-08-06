# EART — Enterprise Readiness & Gap Assessment

**Status:** Candid internal assessment · **Audience:** security leadership + external red teams evaluating EART · **Bias:** deliberately pessimistic — this document exists to find what's missing, not to sell.

> **One-line verdict:** EART is a genuine, honestly-built **red-team aggregator** — it now runs four real engines (or clearly labels where it doesn't) behind one self-hosted dashboard. It is **not** a turnkey system that "covers everything" or that would pass a top-tier enterprise security/procurement review as-is. Treat it as a capable accelerant for a skilled team, not a replacement for one.

---

## 1. How to read this

Every gap below carries three tags:

- **Impact** — how much a serious evaluator would care: 🔴 blocker · 🟠 major · 🟡 minor
- **Effort** — rough build cost: `S` (days) · `M` (1–3 wks) · `L` (1–3 mo) · `XL` (quarter+)
- **Confidence** — how sure this assessment is: ✔ verified in code · ◑ inferred · ○ unverified claim to check

Sections are ordered by how quickly a real red team would raise them.

---

## 2. What EART actually is today (accurate capability statement)

| Engine | Reality | Confidence |
|--------|---------|-----------|
| **Garak** | Runs the real NVIDIA `garak` tool via its REST generator; reports garak's own detector verdicts. | ✔ |
| **DeepTeam** | Runs the real `deepteam` framework **when an independent evaluator LLM is configured**; else labelled heuristic probes. | ✔ |
| **PyRIT** | Runs Microsoft's real `PyRIT` toolkit **when an evaluator LLM is configured**; else labelled heuristic probes. | ✔ |
| **Promptfoo** | Real `evaluate` harness for cloud providers; EART's own `PLUGIN_ATTACKS` for Ollama/custom, graded by regex + optional AI judge. | ✔ |

This is a real improvement over the prior state (all four were hand-written probes with regex grading). The honesty is now load-bearing: findings are tagged `mode: deepteam-real` / `pyrit-real` / `builtin-heuristic` so a reader can tell what actually ran.

**What that does *not* mean:** breadth, calibration, live-run reliability, and enterprise controls are all still open. See below.

---

## 3. Assessment methodology (and its limits)

The engine integrations were validated **against the real upstream packages' APIs** (correct classes, attack/scorer contracts, result semantics) and end-to-end **against mock LLM servers** — confirming protocol integrity, result mapping, and error handling.

**They have NOT been validated against real target models with a real evaluator LLM**, because this environment has no model API keys. The Docker worker images have **never been built or run in CI** (they're heavy — Rust + ML stacks). So "it works" is established at the **integration layer**, not proven in a live enterprise scan. This is the single most important caveat in this document. 🔴

---

## 4. Gap register

### A. Engine coverage depth — 🟠 Impact (was 🔴) · `L` Effort · ◑ Confidence · **partially addressed**
EART maps a **curated slice** of each engine. Coverage was expanded **60 → 82 plugins**: +11 garak probes (verified present) and +11 deepteam vulnerabilities (verified in-package).

| Engine | Roughly available upstream | Mapped in EART | Gap |
|--------|---------------------------|----------------|-----|
| Garak | ~100+ probe modules | ~27 probe groups | still a subset |
| PyRIT | dozens of attacks / converters / scorers | 9 plugins → 7 attack strategies | converters/multimodal still unexposed |
| DeepTeam | 40+ vulnerability types | ~24 vulnerabilities | closer, still not full |

*(Counts are approximate — verify against the pinned tool versions.)* Materially broader now, but still not parity — full garak probe coverage, PyRIT converters/multimodal, and a native-config pass-through for power users remain follow-up. A serious evaluator will still want more breadth, but the "thin veneer" characterization no longer holds.

### B. Live-model validation & run reliability — ✅ **Addressed** (was 🔴)
**Now implemented:** a separate **Worker Images** CI workflow builds all three garak/pyrit/deepteam images (matrix + buildx cache) and protocol-checks each, triggered on `python-workers/**` changes / weekly / manual so the heavy builds don't slow normal PRs — closing "images never built in CI." And a standalone **live-model smoke** (`npm run smoke:live`) drives a real adversarial prompt through a real target + independent judge end-to-end, wired into CI to run whenever a maintainer supplies the secrets (skips cleanly otherwise). *Residual:* the live smoke covers the target-call + judge path, not yet a full multi-plugin scan against live models; deeper run-reliability hardening (mid-tree-attack partial failures, provider-quirk matrix) is follow-up.

### C. Cost & rate governance — ✅ **Addressed** (was 🔴)
Multi-turn adversarial attacks can fire hundreds of LLM calls per plugin. **Now implemented:** a pre-run cost estimate (`GET /api/scans/estimate`) giving an upper-bound target-call count per engine; a hard ceiling `SCAN_MAX_TARGET_CALLS` (default 25 000) that refuses over-budget scans at creation with the estimate; and `SCAN_TARGET_RATE_LIMIT` (calls/min) throttling EART's own attack-loop calls. *Residual:* the Dockerised workers self-bound via their prompt/turn caps (`GARAK_PROMPT_CAP`, `PYRIT_TREE_*`, `DEEPTEAM_*`) rather than the shared throttle, and there is not yet a *token*-denominated budget (calls, not tokens). Good enough to stop runaway scans; token-accurate billing is follow-up.

### D. Authorization & safety guardrails on targets — ✅ **Addressed** (was 🟠)
Nothing previously stopped EART being pointed at a third party's endpoint. **Now implemented:** a target authorization allow-list (`TARGET_ALLOWLIST`, exact or `*.wildcard` hosts) enforced at project create/update **and** re-checked at scan time; the SSRF metadata/private-IP denylist still applies underneath. *Residual:* no cryptographic proof-of-ownership and no per-scan signed authorization record — the allow-list is administrator-configured trust, which is the standard bar but not attestation.

### E. Detection quality & calibration — 🟠 Impact · `L` Effort · ◑ Confidence
The AI judge and the DeepTeam/PyRIT scorers are only as good as the evaluator model (Haiku by default). There is **no ground-truth benchmark, no measured false-positive/negative rate, no inter-rater/human-review workflow, and no confidence surfaced per finding**. A red team will not trust an automated "vulnerable/safe" verdict without knowing its error rate. **Needed:** a labelled benchmark set, a scored eval of the judge, and a human-triage queue.

### F. Enterprise IAM & compliance — 🟠 Impact · `XL` Effort · ◑ Confidence · **partially addressed**
- **Audit log — ✅ done.** An append-only `audit_log` records logins (incl. failures), project/scan/user mutations with actor, target, IP and ms-timestamp; admin-readable/filterable at `GET /api/audit`. *Residual:* no SIEM/export pipeline or tamper-evidence (hash chaining) yet.
- **SSO (OIDC + SAML) — ✅ done.** OpenID Connect authorization-code login with real JWKS ID-token verification, **and** SAML 2.0 (SP) with library-backed signed-assertion validation. Domain allow-list, auto-provisioning, audit-logged, feature-flagged.
- **SCIM 2.0 provisioning — ✅ done.** IdP-driven user provision/update/deprovision at `/scim/v2` (bearer-token auth), with a `is_active` deactivation flag enforced at login/SSO.
- **IdP group → role mapping — ✅ done.** `SSO_GROUP_ROLE_MAP` maps OIDC/SAML groups to EART roles (highest-privilege wins, `*` catch-all), synced on each login without clobbering manual roles. *Residual:* no scheduled reconciliation job for users who never log in again; group→*custom-role* mapping isn't wired (groups map to base tiers only).
- **Custom roles & fine-grained permissions — ✅ done.** Beyond the 3 fixed tiers, admins can define **custom roles** (named permission sets from a ~17-permission catalog) and assign them per user; effective permissions are the *union* of the base tier and the assigned role (base tier is a floor, admin holds all). A `requirePermission(...)` guard backs the checks (the audit log now enforces `audit:read`, so it's delegable), effective permissions are surfaced on `/api/auth/me` + login, and it's managed from Settings or the `/api/roles` admin API. *Residual:* this is **additive RBAC, not a policy engine** — no ABAC, no per-resource/ownership rules, no deny rules, and most existing routes still gate on the base tier rather than individual permissions (only `audit:read` is enforced granularly so far); a custom-role assignment change takes effect on the user's next login (JWT-carried).
- Secrets: API keys are encrypted at rest (✔ addressed earlier) but there's no KMS/Vault integration or rotation.
- **Data retention & minimization — ✅ done.** Time-based purge of scans/results/reports (`DATA_RETENTION_DAYS`) and audit log (`AUDIT_RETENTION_DAYS`) on a daily schedule + on-demand admin endpoint, and response minimization (`SCAN_STORE_RESPONSES=false`) to avoid persisting raw prompt/response text. *Residual:* no data-*residency* (region-pinning) controls, and no per-project retention overrides yet.
- No documented threat model of EART itself, no third-party pentest, no SOC2/ISO evidence. **(external/organizational, not code)**

### G. Operational maturity — 🟡 Impact · `L` Effort · ◑ Confidence
Single-node by default (SQLite; Postgres supported ✔). No HA, no horizontal scale story for the worker fleet, no documented multi-tenant isolation guarantees, no resource quotas per user/org. Fine for a team tool; not for a shared enterprise service.

### H. Reporting, frameworks & reproducibility — 🟡 Impact · `M` Effort · ◑ Confidence · **partially addressed**
OWASP-LLM tagging exists; PDF/HTML/CSV/JSON export exists. **Run reproducibility — ✅ done:** each scan records a `run_metadata` snapshot (plugins, engine image tags, knob values, evaluator model) at run start. **MITRE ATLAS + NIST AI RMF mappings — ✅ done:** findings map to ATLAS techniques (AML.T0051/0054/0056/0057, …) and NIST AI RMF trustworthiness characteristics, surfaced in the catalog API and JSON report with an aggregated coverage summary (labelled *indicative*, not a certified attestation). *Still missing:* HTML/PDF surfacing of the framework coverage, exact numbered NIST subcategories, exact in-container tool versions (image tags stand in), chain-of-custody/evidence integrity, and longitudinal trend tracking across scans.

### I. Test coverage of EART itself — 🟡 Impact · `M` Effort · ✔ Confidence
~126 backend + ~56 Python worker unit tests + frontend tests. Good for a project this size, but there are **no integration tests against live models, no load/soak tests, and the worker images aren't exercised in CI**. Coverage of the scan pipeline's failure modes (cancellation mid-tree-attack, evaluator outage, partial persistence) is light.

---

## 5. What it would take

**Tier 1 — "Pilot-ready" (make the current claims bulletproof):** live-model e2e harness + CI image build (B), per-scan cost budget + estimate + target rate-limit (C), target authorization/allow-list (D). *Est. 3–5 weeks.* After this, "the four engines really run" is *provable*, not just asserted.

**Tier 2 — "Trustworthy findings":** detection benchmark + judge eval + human-triage queue (E), coverage expansion toward each tool's real surface (A), framework mappings + reproducibility (H). *Est. 1–2 months.*

**Tier 3 — "Enterprise-grade":** SSO/RBAC/audit/secrets/data-governance (F), HA + multi-tenancy + quotas (G), threat model + third-party pentest of EART itself. *Est. a quarter+ and arguably a product decision, not just engineering.*

---

## 6. Honest positioning

**Use EART for:** a self-hosted team that wants to run Garak/PyRIT/DeepTeam/Promptfoo against their own models behind one dashboard, with a shared history and reports — an accelerant that removes tool-wrangling toil.

**Do not represent EART as:** a complete, calibrated, audited enterprise platform that "covers everything a red team needs" or that clears a security review unchanged. It doesn't, yet — and no single tool does. A real red team still brings its own tooling, manual testing, and judgment; EART amplifies that, it doesn't replace it.

If you hand a red team *this document* alongside the platform, you'll get a far better reception than any "it's done" claim — because it shows you know exactly where the edges are.
