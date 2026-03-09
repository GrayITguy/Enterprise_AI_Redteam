# Changelog

All notable changes to the Enterprise AI Red Team Platform are documented here.

Format: [Semantic Versioning](https://semver.org/) — `Added`, `Changed`, `Fixed`, `Removed`.

---

## [Unreleased] — Configurable Ollama Timeout

### Changed
- **Ollama timeout increased from 5 minutes to 15 minutes and made configurable** — All Ollama request timeouts (remediation, relay, scan attacks, endpoint gateway) now use a shared `OLLAMA_TIMEOUT` environment variable (value in seconds, default 900 = 15 minutes). Smaller/slower local models like `qwen3:4b` no longer time out during remediation plan generation. Error messages now display the actual configured timeout and mention the env var. Set `OLLAMA_TIMEOUT` in `.env` to tune for your hardware.

---

## [Unreleased] — Full Dependency Upgrade

### Changed
- **Backend dependencies upgraded to latest majors**: Express 4→5, Zod 3→4, Drizzle ORM 0.38→0.45, better-sqlite3 11→12, bcryptjs 2→3, node-cron 3→4, nodemailer 7→8, uuid 11→13, Vitest 2→4, plus minor bumps for bullmq, ioredis, winston, cors, helmet, jsonwebtoken, @anthropic-ai/sdk, pdfkit, promptfoo, tsx, typescript
- **Frontend dependencies upgraded to latest majors**: React 18→19, React Router 6→7, Tailwind CSS 3→4, Vite 6→7, Recharts 2→3, tailwind-merge 2→3, lucide-react 0.475→0.577, jsdom 25→28, plus minor bumps for @tanstack/react-query, axios, clsx, date-fns, zustand, @testing-library/*
- **Tailwind CSS 4 migration**: replaced JS config with CSS `@theme` directives, switched from PostCSS plugin to `@tailwindcss/vite`, removed autoprefixer (bundled in Tailwind 4)
- **Express 5 migration**: updated `AuthenticatedRequest` params type, modernized error handler to `ErrorRequestHandler`
- **Removed `@types/uuid`** (uuid v13 ships its own types)

---

## [Unreleased] — Settings, Remediation Config & Progress Bar

### Added
- **Settings page: SMTP configuration** — admins can configure SMTP (host, port, TLS, credentials, from address) directly from the web UI instead of editing `.env` files. Includes "Send Test Email" button. DB settings take precedence over env vars; env vars remain as fallback.
- **Settings page: AI Remediation provider** — admins can set a default AI provider (Ollama, OpenAI, Anthropic, or custom endpoint) for remediation plan generation across all projects, with per-project override option. Includes enable/disable toggle.
- **`appSettings` database table** — key-value platform configuration store with AES-256-CBC encryption for sensitive values (API keys, SMTP passwords).
- **Settings API** — `GET/PUT /api/settings/smtp`, `POST /api/settings/smtp/test`, `GET/PUT /api/settings/remediation`, `POST /api/settings/models` endpoints with admin role enforcement.
- **Model auto-detection in Remediation settings** — Ollama and OpenAI-compatible endpoints are probed automatically when the admin enters an endpoint URL (or API key for OpenAI). Detected models populate a dropdown selector instead of a manual text input. Anthropic shows its well-known model list. A manual "Detect" button is also available.
- **Remediation enabled guard** — Remediation page shows a disabled banner when an admin has turned off AI remediation.

### Fixed
- **Scans against OpenAI-compatible (custom) endpoints return empty responses** — The promptfoo HTTP provider used a single hardcoded `transformResponse` path (`json.choices[0].message.content`) that silently returns `undefined` when the endpoint responds with a different JSON structure. Empty responses were then recorded as "passed" tests, making scan results unreliable. Fixed by bypassing promptfoo's HTTP provider for custom endpoints entirely: scans now call the endpoint directly with multiple fallback extraction paths (`choices[0].message.content`, `choices[0].text`, `message.content`, `response`, `output`) — matching the logic that already works for remediation and settings tests. Also added empty response detection to the promptfoo evaluate path (for openai/anthropic/azure providers) so empty outputs are flagged as errors instead of silently passing.
- **Ollama relay timeout too short for scan-time remediation** — Increased Ollama relay timeout from 120s to 300s so slow local models don't time out during long-running prompts.
- **Switching AI Remediation provider doesn't clear stale settings** — When switching providers (e.g., Ollama → OpenAI), the endpoint URL, API key, and model from the previous provider persisted, causing OpenAI calls to route to `localhost:11434` (Ollama's URL) and Ollama models like `qwen3:4b` to appear under OpenAI. Frontend now clears all provider-specific fields on switch and only includes provider-relevant fields in the save payload. Backend now reads the old provider type before overwriting, builds a sanitized config with only provider-relevant fields, and only carries over API keys when the provider type hasn't changed.
- **OpenAI/Anthropic remediation fails instantly with wrong model name** — `callLLM()` used a hardcoded `"llama3"` fallback model for all providers. Since the fallback was always truthy, the per-provider defaults in `callProvider()` (e.g., `"gpt-4o-mini"` for OpenAI) were dead code. OpenAI would receive model `"llama3"` and reject it immediately. Moved the default into each provider's own `callProvider` case so Ollama defaults to `"llama3"`, OpenAI to `"gpt-4o-mini"`, and Anthropic to `"claude-haiku-4-5-20251001"`.
- **OpenAI models not auto-detected when API key entered** — Unlike Ollama (auto-detects on endpoint change) and Anthropic (static list), OpenAI had no auto-detection trigger. Users had to manually click the "Detect" button. Added a debounced `useEffect` that triggers model detection 800ms after the user enters an OpenAI API key, populating the model dropdown automatically.
- **AI provider settings not used for remediation & narrative generation** — Executive summary (narrative) and remediation plan generation now respect the admin-configured AI provider from Settings. Previously the narrative endpoint always used the project's own provider, ignoring saved settings. Extracted duplicated `callLLM`/`callProjectProvider` logic (~170 lines each in `remediation.ts` and `results.ts`) into a shared `aiProvider.ts` service to prevent future drift.
- **Ollama unreachable from Docker — model detection, executive summary, and remediation all fail** — `aiProvider.ts` and `settings.ts` never called `resolveForHost()`, so `localhost` URLs stayed as-is inside Docker containers (where `localhost` is the container itself, not the host). Now all provider URLs in `callProvider()` and `/api/settings/models` are resolved through `resolveForHost()` which rewrites `localhost`/`127.0.0.1` → `host.docker.internal` when running in Docker.
- **Ollama chat timeout too short** — The Ollama provider in `aiProvider.ts` used an 8-second timeout, far too short for remediation prompts that can take 30–60 seconds. Increased to 120 seconds to match the OpenAI/custom provider timeouts. Settings model detection timeout also increased from 5 to 10 seconds to handle cold starts.
- **Progress bar jumps to 100% immediately** — `totalTests` was incremented alongside completed tests, making the ratio always ~100%. Now pre-calculates expected test count from `PLUGIN_ATTACKS` before scanning begins, and tracks a dedicated `progress` column (0-99% during scan, 100% on completion). Docker worker results that exceed the estimate gracefully adjust the total upward.

### Changed
- **Extracted `PLUGIN_ATTACKS` to `src/server/config/attackPatterns.ts`** — moved the adversarial attack library (~175 entries) and `PLUGIN_DISPLAY` mapping out of `scanner.ts` into a dedicated config file, reducing `scanner.ts` by ~200 lines
- **Created `src/server/utils/helpers.ts`** — consolidated duplicate `isLocalhostUrl()` (previously copied in both `scanner.ts` and `dockerRunner.ts`) and `safeJsonParse<T>()` (previously inlined in `projects.ts`) into a single shared module
- **Created `src/server/config/constants.ts`** — unified `OWASP_NAMES` mapping (previously duplicated in `remediation.ts` and `reportGenerator.ts`) into one canonical definition
- **Created `site/src/lib/constants.ts`** — centralized frontend severity constants (`SEVERITY_ORDER`, `SEVERITY_COLORS`) and `OWASP_NAMES` previously duplicated across `Results.tsx`, `Remediation.tsx`, `ScanBuilder.tsx`, and `Dashboard.tsx`

---

## [Previous] — Endpoint Auto-Bridge

### Added
- **Endpoint Auto-Bridge** — zero-config local model scanning that makes `localhost` AI endpoints (Ollama, etc.) reachable from Docker-sandboxed scan workers:
  - `src/server/services/endpointGateway.ts` — lightweight HTTP reverse proxy (zero new deps) that runs on the host and bridges Docker containers to localhost services via `host.docker.internal`
  - `src/server/routes/connectivity.ts` — `POST /api/connectivity/check` pre-flight endpoint that validates server-side reachability with latency, model enumeration, and actionable error suggestions
  - **ScanBuilder pre-flight check** — auto-fires connectivity test when a project is selected; shows green/amber/red status with latency and model count
  - **Projects page dual-check** — now shows both browser and server connectivity status when testing Ollama connections
  - **Direct Ollama scan path** — Promptfoo attacks now call Ollama directly from the server when reachable, falling back to the browser relay only for truly remote deployments (eliminates "keep browser tab open" requirement)
- **Docker-aware URL resolution** (`src/server/utils/resolveEndpoint.ts`) — auto-detects Docker environment via `/.dockerenv` and rewrites `localhost`/`127.0.0.1` URLs to `host.docker.internal` so containers can reach host services. Zero-impact passthrough when running natively.
- **`OLLAMA_URL` env var** — optional override for Ollama endpoint in Docker deployments (`.env.example` documented)
- **`EART_APP_URL` env var** — set in docker-compose for the worker container (`http://app:3000`) so the relay forward path uses Docker-internal DNS instead of unreachable `localhost:3000`

### Fixed
- **Critical: camelCase/snake_case config mismatch** — `dockerRunner.ts` sent `targetUrl` (camelCase) but all three Python workers (Garak, PyRIT, DeepTeam) read `target_url` (snake_case), causing every Docker-based scan to receive empty config fields. Added `toSnakeConfig()` key transformation before serialization.
- **Docker cross-platform networking** — replaced `--network=host` (Linux-only, security risk) with `--add-host=host.docker.internal:host-gateway` which works on Linux, macOS, and Windows Docker Desktop. Localhost URLs are automatically rewritten to `host.docker.internal:{gatewayPort}` for Docker containers.
- **Docker container → host Ollama networking** — `probeOllama()`, direct Ollama attacks, and the endpoint gateway proxy all now resolve `localhost` to `host.docker.internal` when running inside Docker, fixing `"TypeError: fetch failed"` errors.
- **Worker → app relay networking** — relay forward URL (`http://localhost:3000/api/ollama/relay/forward`) now uses `EART_APP_URL` (Docker-internal DNS `http://app:3000`) when the worker runs as a separate container, fixing relay connection failures.
- **`docker-compose.yml`** — added `extra_hosts: ["host.docker.internal:host-gateway"]` to both `app` and `worker` services for Linux host resolution support.

---

## [Previous] — OSS Release Preparation

### Added
- **Full test suite** — zero-to-comprehensive coverage across all four layers:
  - Backend unit tests (`src/__tests__/pluginCatalog.test.ts`, `scanner.test.ts`) using Vitest
  - Backend route integration tests (`auth`, `projects`, `scans`) using Vitest + Supertest with in-memory SQLite
  - Frontend component tests (`Login`, `Dashboard`, `ScanBuilder`) using Vitest + React Testing Library
  - E2E tests (`e2e/auth.spec.ts`, `e2e/scan.spec.ts`) using Playwright
- **Test npm scripts**: `npm test`, `npm run test:watch`, `npm run test:coverage`, `npm run test:e2e`
- **Frontend test scripts**: `cd site && npm test`, `npm run test:coverage`
- **`vitest.config.ts`** — backend test configuration with in-memory SQLite isolation and Redis/queue mocking
- **`site/vitest.config.ts`** — frontend test configuration with jsdom environment and `@/` path alias
- **`playwright.config.ts`** — E2E test configuration targeting local dev servers
- **`scripts/install.sh`** — one-command Linux/macOS installer: checks Docker prereqs, auto-generates `.env` with secure `JWT_SECRET`, builds all images, starts services, polls health endpoint
- **`scripts/install.bat`** — equivalent Windows PowerShell installer
- **`.github/workflows/ci.yml`** — GitHub Actions CI pipeline: type-check (backend + frontend), backend tests, frontend tests, build verification; triggers on push/PR to main
- **Docker scripts** in `package.json`: `docker:build`, `docker:up`, `docker:down`, `docker:install`

### Changed
- **`docker-compose.yml`** — Removed `profiles: [workers]` from `garak-worker`, `pyrit-worker`, and `deepteam-worker` services. Python security workers now build automatically with `docker compose build` / `docker compose up`. Previously these workers required a separate `docker compose --profile workers build` step, meaning 27 of 41 vulnerability tests were unavailable by default.
- **`src/server/app.ts`** — `bootstrap()` (server listen + migrations + scheduler) is now guarded by `NODE_ENV !== 'test'`, enabling the Express app to be imported cleanly in integration tests without starting the HTTP server.

### Fixed
- **Workers not optional**: Security workers are core functionality, not optional — they are now always built as part of the standard stack.

---

## [1.0.0] — Initial Release

- 41-plugin vulnerability catalog covering OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more
- Four integrated tools: Promptfoo, Garak, PyRIT, DeepTeam
- React dashboard with scan builder, results viewer, OWASP radar chart, and AI-powered remediation engine
- JWT authentication with admin / analyst / viewer roles and invite-code registration
- BullMQ scan queue backed by Redis with recurring scan scheduling (daily / weekly / monthly)
- PDF and JSON report generation
- Email notifications (always / failure-only / never)
- RSA-based license management with free-tier enforcement
- Docker Compose deployment with multi-stage Dockerfile
- SQLite (default) or PostgreSQL via Drizzle ORM
- Ollama integration for air-gapped / local model scanning
