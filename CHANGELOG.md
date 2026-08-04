# Changelog

All notable changes to the Enterprise AI Red Team Platform are documented here.

Format: [Semantic Versioning](https://semver.org/) — `Added`, `Changed`, `Fixed`, `Removed`.

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
