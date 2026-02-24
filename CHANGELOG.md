# Changelog

All notable changes to the Enterprise AI Red Team Platform are documented here.

Format: [Semantic Versioning](https://semver.org/) — `Added`, `Changed`, `Fixed`, `Removed`.

---

## [Unreleased] — OSS Release Preparation

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
