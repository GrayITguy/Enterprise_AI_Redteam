# Changelog

All notable changes to the Enterprise AI Red Team Platform are documented here.

Format: [Semantic Versioning](https://semver.org/) — `Added`, `Changed`, `Fixed`, `Removed`.

---

## [Unreleased]

### Added
- **Accessibility pass.** The UI now respects `prefers-reduced-motion` (the ambient cyberpunk animations — circuit drift, neon pulse, flicker, spinners — are disabled for users who ask for reduced motion), shows a visible keyboard focus ring on every interactive element, and adds a "skip to main content" link, a `<main>` landmark, a labelled primary navigation, ARIA labels on icon-only buttons, and a live region + proper `progressbar` semantics on the scan progress. _(A light color theme was evaluated but deferred: the interface is a deliberately dark "cyberpunk" design with pervasive neon styling, so a light mode needs dedicated design work rather than a mechanical token flip.)_
- **Live scan progress (SSE) and a cancel button.** A running scan's page now streams progress over Server-Sent Events (`GET /api/scans/:id/events`) instead of relying on polling alone — the worker publishes each progress/status update through a Redis channel that the app fans out to watching browsers (one Redis connection per app process, not per viewer). Polling remains as an automatic fallback if the stream drops. The scan page also gains a **Cancel** button, so the prompt cross-process cancellation added earlier is finally reachable from the UI.
- **User management (admin).** Admins can now list all users, change their roles, and remove them from a new Users section in Settings (`GET/PATCH/DELETE /api/users`). Deleting a user cascades their projects, scans, results and reports in a transaction. Guardrails prevent demoting or deleting the last remaining admin, and deleting your own account.
- **Remediation before/after comparison.** After running "Verify Fixes", the retest's results page shows a before/after panel comparing the retest against the original scan by OWASP category — how many categories were fixed, improved, or still failing (`GET /api/scans/:id/diff?original=<scanId>`). It updates live while the retest runs.
- **HTML and CSV report formats.** Alongside PDF and JSON, scans can now be exported as a self-contained styled HTML report (severity cards, OWASP coverage, failed-finding detail — no external assets) and as a spreadsheet-friendly CSV (RFC-4180 quoted, UTF-8 BOM for Excel). The Reports page offers all four formats.

### Changed
- **Scan results are paginated and stats are aggregated in SQL.** `GET /api/scans/:id/results` now takes `limit`/`offset` and returns a `{ results, total, limit, offset }` envelope, and the results-summary endpoint aggregates with `COUNT`/`GROUP BY` instead of loading every finding row into memory — so a scan with tens of thousands of findings no longer risks OOMing the API. The Results page drives its charts from the summary endpoint and pages through findings with a "Load more" button. Also fixed a summary bug where passing `info` findings were miscounted as failures.
- **Scan progress writes are batched.** The scanner flushes the scan row's running counters every 20 findings (and at each tool boundary) instead of once per finding, cutting write contention on the shared SQLite file.
- **Ollama browser relay moved to Redis.** The relay queue and pending responses now live in Redis (blocking-list based) instead of in the app process's memory. The scan worker enqueues relay requests directly rather than HTTP-POSTing to its own app with a minted internal token, and poll/fulfill work across app replicas (a browser polling one replica and a producer waiting on another share the same queue). Per-user scoping and cross-user isolation are preserved via a per-request owner key. Removed the now-unused `/api/ollama/relay/forward` endpoint and the internal-token minter.
- **Prompt, cross-process scan cancellation.** Cancelling a scan now publishes a Redis pub/sub signal that the worker acts on immediately — aborting the in-flight tool and killing its Docker container mid-run — instead of only being noticed between tools by DB-status polling. The signal fans out to every worker replica, so cancellation works when the app and worker (or multiple workers) run as separate processes. Persisted scan status remains the durable source of truth and the polling fallback still guarantees eventual cancellation if a subscriber is momentarily disconnected.

### Security
- **Report download hardening.** The file-path containment check now uses a separator-terminated match (a sibling like `<dir>-evil` no longer passes), and the download filename is built from the report's own sanitized scan id rather than the raw URL parameter.

---

## [2.2.0] — 2026-08-04

### Fixed
- **Garak / PyRIT / DeepTeam findings were silently discarded** — the Python workers emit snake_case JSON (`test_name`, `owasp_category`) but the backend read camelCase, so every insert into the `NOT NULL` `test_name` column threw and was swallowed. Scans reported only Promptfoo results while claiming all four tools ran. `dockerRunner` now normalizes worker output, awaits result persistence before resolving, surfaces worker error lines instead of parsing them as findings, and no longer reports a crashed worker as a clean scan.
- **OWASP categories were almost never recorded** — the scanner re-derived severity/OWASP from an 8-entry substring map covering 8 of 60 plugins, so most findings stored `owaspCategory: null` and reports showed "Not Tested". Severity and OWASP now come from the authoritative plugin catalog.
- **Scan cancellation was cosmetic** — cancelling flipped the DB status but the running scan finished anyway and overwrote it back to `completed`, leaving orphaned Docker containers. Cancellation is now honoured across process boundaries: in-flight tools stop, worker containers are killed by name, partial results are kept, and the status stays `cancelled`.
- **BullMQ retries duplicated results and corrupted counts** — a retried scan left the previous attempt's rows in the database. Each (re)start now clears prior results and resets counters so a retry is idempotent.
- **Scans could hang in `running` forever** after a worker crash — the worker now recovers orphaned `running` scans (with no live job) to `failed` on startup, and aborts in-flight scans on shutdown so their containers are killed rather than orphaned.

### Security
- **SSRF hardening** — the AI-remediation/narrative and direct-endpoint scan paths fetched user-supplied URLs with no guard, allowing requests to cloud-metadata endpoints (e.g. `169.254.169.254`). A denylist guard now blocks cloud-metadata and link-local targets on those paths (loopback and LAN hosts remain reachable for local models).
- **Ollama browser relay is now scoped per user** — poll/fulfill were global, letting any authenticated user pull another user's queued scan prompts off the queue or inject fabricated LLM responses into their results. Relay items are now bound to the owning user, and the scan worker authenticates its forward calls as the scan owner via a short-lived internal token.
- **Project provider API keys are no longer returned to clients** — the projects API echoed the stored `apiKey` in plaintext. It is now redacted to a `hasApiKey` flag (matching the SMTP-password pattern) and preserved across partial updates so it is never wiped by a save that omits it.
- Docker worker containers now run with `--pids-limit` in addition to the existing memory/CPU/`no-new-privileges` constraints.

### Added
- Tests for worker-result normalization, the SSRF denylist guard, provider-config redaction/secret-preservation, and per-user relay isolation (backend suite: 61 → 81).

---

## [2.1.0] — 2026-08-04

### Changed
- **EART is now 100% free and open source** — every feature is available to everyone, always. All references to paid tiers have been removed from the platform, docs, and UI.
- **Dependency refresh to latest versions** across backend and frontend, including TypeScript 7 (native compiler), Vite 8 (Rolldown bundler), better-sqlite3 13, BullMQ 6, ioredis 6, Nodemailer 9, pdfkit 0.19, uuid 14, lucide-react 1.x, jsdom 30, and the latest Anthropic SDK, Radix UI, TanStack Query, React Router, Recharts, and Zod releases.
- **Runtime upgrades** — Docker images now build on Node.js 24 LTS; Redis bumped to 8; GitHub Actions CI runs on Node 24 with `actions/checkout@v5` / `actions/setup-node@v5`.
- **Vite config migrated to Rolldown** — `manualChunks` replaced with `advancedChunks`, `__dirname` replaced with `import.meta.dirname` for native config loading.
- **Security overrides** — pinned `adm-zip`, `sharp`, and `undici` transitive dependencies to patched versions; backend `npm audit` is now clean.

### Removed
- **License key system** — the license activation API (`/api/license`), license validator, RSA keygen script, `license_keys` database table, License page, and `RSA_PUBLIC_KEY_PATH` configuration have all been removed. No license is needed: the platform is fully unlocked for everyone.

---

## [2.0.0] — 2026-03-16

### Added
- **19 new vulnerability plugins** (41 → 60 total) across all 4 tools:
  - **Promptfoo** (15 → 21): SSRF, Excessive Agency, Competitor Endorsement, Brand Imitation, Misinformation/Disinformation, Copyright Violations
  - **Garak** (12 → 17): RealToxicityPrompts, Package Hallucination, Do-Not-Answer Compliance, Language Model Risk Cards, Emotional Manipulation (Grandma)
  - **PyRIT** (6 → 9): Tree of Attacks with Pruning (TAP), Cross-Domain Prompt Injection (XPIA), FlipAttack Encoding Bypass
  - **DeepTeam** (8 → 13): Political Bias, Religion Bias, Input Hijacking, PII Session Leakage, Health Misinformation
- **Settings page: SMTP configuration** — admins can configure SMTP from the web UI with "Send Test Email" button. DB settings take precedence over env vars.
- **Settings page: AI Remediation provider** — configure a default AI provider (Ollama, OpenAI, Anthropic, or custom endpoint) for remediation across all projects, with per-project override and model auto-detection.
- **`appSettings` database table** — key-value store with AES-256-CBC encryption for sensitive values.
- **Endpoint Auto-Bridge** — zero-config local model scanning; `localhost` endpoints automatically bridged into Docker workers.
- **`OLLAMA_TIMEOUT` env var** — configurable Ollama timeout (default 900s / 15 min).
- **`OLLAMA_URL` env var** — override Ollama endpoint for Docker deployments.
- **`EART_APP_URL` env var** — worker→app communication URL (auto-set in docker-compose).
- **Full test suite** — backend unit/integration tests (Vitest + Supertest), frontend component tests (Vitest + React Testing Library), E2E tests (Playwright).
- **Install scripts** — `scripts/install.sh` (Linux/macOS) and `scripts/install.bat` (Windows).
- **CI pipeline** — GitHub Actions: type-check, tests, build on every push/PR.

### Changed
- **Dependency upgrade to latest majors**: Express 4→5, React 18→19, Tailwind CSS 3→4, Vite 6→7, Zod 3→4, Drizzle ORM 0.38→0.45, Recharts 2→3, React Router 6→7, and many more.
- **Quick Scan preset** expanded from 8 to 10 plugins (added Excessive Agency, RealToxicityPrompts).
- **OWASP preset** expanded to 22 plugins with broader LLM02, LLM08, LLM09, LLM10 coverage.
- **Full Enterprise Scan** covers all 60 plugins.
- **Garak** version requirement bumped to >=0.14.0; **PyRIT** to >=0.11.0.
- **Ollama timeout** increased from 5 min to 15 min (configurable via `OLLAMA_TIMEOUT`).
- **Tailwind CSS 4 migration** — CSS `@theme` directives replace JS config; `@tailwindcss/vite` replaces PostCSS plugin.
- **Express 5 migration** — updated `AuthenticatedRequest` params type, modernized error handler.
- Extracted shared utilities: `attackPatterns.ts`, `helpers.ts`, `constants.ts`, `aiProvider.ts`.
- Python security workers now build by default with `docker compose build` (no longer behind `--profile workers`).

### Fixed
- **Scans against OpenAI-compatible endpoints return empty responses** — bypassed promptfoo's HTTP provider for custom endpoints; added empty response detection.
- **Switching AI provider doesn't clear stale settings** — frontend clears provider-specific fields on switch; backend sanitizes config.
- **OpenAI/Anthropic remediation fails with wrong model name** — removed hardcoded `"llama3"` fallback; each provider now uses its own default.
- **Ollama unreachable from Docker** — all provider URLs now resolve through `resolveForHost()`.
- **Progress bar jumps to 100% immediately** — pre-calculates expected test count; tracks dedicated `progress` column.
- **Critical camelCase/snake_case config mismatch** — `dockerRunner.ts` now sends snake_case keys to Python workers.
- **Docker cross-platform networking** — replaced `--network=host` with `--add-host=host.docker.internal:host-gateway`.

---

## [1.0.0] — Initial Release

- 41-plugin vulnerability catalog covering OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more
- Four integrated tools: Promptfoo, Garak, PyRIT, DeepTeam
- React dashboard with scan builder, results viewer, OWASP radar chart, and AI-powered remediation engine
- JWT authentication with admin / analyst / viewer roles and invite-code registration
- BullMQ scan queue backed by Redis with recurring scan scheduling (daily / weekly / monthly)
- PDF and JSON report generation
- Email notifications (always / failure-only / never)
- Docker Compose deployment with multi-stage Dockerfile
- SQLite (default) or PostgreSQL via Drizzle ORM
- Ollama integration for air-gapped / local model scanning
