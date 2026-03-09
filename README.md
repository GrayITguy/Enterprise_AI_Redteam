# Enterprise AI Red Team Platform

**The missing unified self-hosted security testing dashboard for AI systems.**

Combines [Promptfoo](https://github.com/promptfoo/promptfoo), [Garak](https://github.com/leondz/garak), [PyRIT](https://github.com/Azure/PyRIT), and [DeepTeam](https://github.com/confident-ai/deepteam) into a single product that security teams will actually use.

- **Self-hosted** — your data never leaves your infrastructure
- **Air-gapped ready** — works with Ollama, no mandatory cloud
- **One command install** — `bash scripts/install.sh` handles everything
- **41 vulnerability tests** — OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more

---

## Features

- **Dashboard** — severity charts, pass-rate trend (last 30 scans), upcoming scans widget, and a notification badge showing newly completed scans
- **Scan Builder** — 41-plugin catalog with full-text search and severity filters; choose from Quick, OWASP, or Full presets or hand-pick plugins; pre-flight connectivity check with green/amber/red status
- **Scan Scheduler** — schedule one-off or recurring scans (daily / weekly / monthly) with email notifications (always / failure-only / never)
- **Results & AI Summary** — per-finding details with prompt/response/evidence, OWASP radar chart, tool breakdown, and an AI-powered executive summary
- **Remediation Engine** — AI-generated remediation plans with risk scoring (0–100), root-cause analysis per OWASP category, copy-pasteable system-prompt hardening, guardrail configs, and one-click verification re-scans — works fully offline via local Ollama
- **Settings (admin)** — configure a default AI provider for remediation & summaries (Ollama, OpenAI, Anthropic, or custom endpoint with model auto-detection), and SMTP for email notifications — all from the web UI
- **Endpoint Auto-Bridge** — zero-config local model scanning; `localhost` AI endpoints are automatically bridged into Docker-sandboxed workers without manual network configuration
- **Reports** — generate and download PDF or JSON reports per scan
- **License Management** — free tier included; activate a commercial license key for unlimited concurrent scans
- **Team Access** — JWT-based auth with admin / analyst / viewer roles and invite-code registration

---

## Quick Start

### Prerequisites
- Docker + Docker Compose v2
- 4 GB RAM minimum (8 GB recommended for running local models)

### One-command install (Linux / macOS)

```bash
git clone https://github.com/yourusername/enterpriseairedteam.git
cd enterpriseairedteam
bash scripts/install.sh
```

The installer:
1. Checks Docker is available and running
2. Generates `.env` with a secure random `JWT_SECRET`
3. Builds all Docker images — app, worker, and all three Python security tool images
4. Starts all services and waits for the health check

Visit **http://localhost:15500** and complete the setup wizard to create your admin account.

### Windows install

```bat
git clone https://github.com/yourusername/enterpriseairedteam.git
cd enterpriseairedteam
scripts\install.bat
```

### Manual install

```bash
git clone https://github.com/yourusername/enterpriseairedteam.git
cd enterpriseairedteam
cp .env.example .env
# Edit .env — set a strong JWT_SECRET (openssl rand -hex 32)
mkdir -p data/reports keys logs
docker compose build   # builds app + all Python security workers
docker compose up -d
```

### (Optional) Run local AI models with Ollama

```bash
docker compose --profile local-ai up -d

# Pull a model (inside Ollama container or host)
docker exec eart-ollama ollama pull llama3
```

Then create a project with `Provider: Ollama` and target URL `http://ollama:11434`.

---

## Development Mode

### Prerequisites
- Node.js 20+
- Redis (`docker run -d -p 6379:6379 redis:7-alpine`)

```bash
# Install dependencies
npm install
cd site && npm install && cd ..

# Copy and configure env
cp .env.example .env

# Create data directory and run DB migrations
mkdir -p data/reports keys logs
npm run db:migrate

# Start backend (port 3000)
npm run dev

# In a separate terminal: start frontend (port 5173)
cd site && npm run dev

# In a separate terminal: start BullMQ worker
npm run dev:worker
```

Visit **http://localhost:5173** (dev) — proxied to backend at :3000.

---

## Architecture

```
Browser (React + Vite)
    │
    ▼ /api/*
Express (Node.js + TypeScript) — port 3000 (15500 external)
    │
    ├── Drizzle ORM → SQLite (./data/eart.db) [or Postgres]
    ├── BullMQ → Redis (scan job queue)
    ├── Scheduler → polls every 5 min for due recurring scans
    ├── Nodemailer → SMTP (env vars or admin-configured via Settings)
    ├── AI Provider → shared service for remediation & summaries
    │                  (admin Settings provider → project provider → ANTHROPIC_API_KEY)
    ├── Endpoint Gateway → reverse proxy bridging localhost → Docker
    └── docker run --rm → Python workers (JSONL stdio)
                              ├── eart-garak:latest
                              ├── eart-pyrit:latest
                              └── eart-deepteam:latest
```

### Python Worker Protocol

Workers communicate via JSONL over Docker stdio:

**Input** (JSON on stdin):
```json
{"target_url": "http://localhost:11434", "model": "llama3", "plugins": ["encoding"], "provider_type": "ollama"}
```

**Output** (one JSON object per line on stdout):
```json
{"test_name": "base64_encoding", "category": "encoding", "severity": "high", "owasp_category": "LLM01", "prompt": "...", "response": "...", "passed": false, "evidence": {}}
```

---

## Folder Structure

```
enterpriseairedteam/
├── docker-compose.yml          # All services
├── Dockerfile                  # Multi-stage build
├── package.json                # Backend deps + scripts
├── tsconfig.json
├── .env.example
├── src/
│   ├── server/
│   │   ├── app.ts              # Express entry point
│   │   ├── config/
│   │   │   ├── pluginCatalog.ts   # 41 plugins + presets
│   │   │   ├── attackPatterns.ts  # Adversarial attack library (PLUGIN_ATTACKS)
│   │   │   └── constants.ts       # Shared backend constants (OWASP_NAMES)
│   │   ├── middleware/
│   │   │   ├── auth.ts          # JWT middleware
│   │   │   └── errorHandler.ts
│   │   ├── routes/             # API route handlers
│   │   │   ├── remediation.ts  # AI remediation + verify re-scans
│   │   │   ├── settings.ts     # SMTP + Remediation provider config
│   │   │   ├── connectivity.ts # Pre-flight endpoint reachability check
│   │   │   └── ...
│   │   ├── services/           # Business logic
│   │   │   ├── scanner.ts      # Scan orchestrator
│   │   │   ├── dockerRunner.ts # Python worker spawner
│   │   │   ├── aiProvider.ts   # Shared AI provider resolution
│   │   │   ├── emailService.ts # Nodemailer notifications (env + DB config)
│   │   │   ├── settingsService.ts # Encrypted key-value settings store
│   │   │   ├── endpointGateway.ts # Reverse proxy: localhost → Docker
│   │   │   ├── ollamaRelay.ts  # Browser relay for Ollama
│   │   │   ├── scheduler.ts    # Recurring scan scheduler
│   │   │   └── reportGenerator.ts
│   │   ├── utils/
│   │   │   ├── resolveEndpoint.ts # Docker-aware URL rewriting
│   │   │   ├── helpers.ts         # Shared utilities (isLocalhostUrl, safeJsonParse)
│   │   │   ├── tokenBudget.ts     # Token estimation + context-window budget
│   │   │   └── logger.ts          # Application logger
│   │   └── workers/
│   │       └── scanWorker.ts   # BullMQ worker process
│   ├── db/
│   │   ├── schema.ts           # Drizzle table definitions (incl. appSettings)
│   │   └── index.ts
│   └── license-validator.ts    # Offline RSA license check
├── site/                       # React frontend (Vite)
│   └── src/
│       ├── lib/
│       │   ├── api.ts              # Axios instance + API helpers
│       │   ├── constants.ts        # Shared UI constants (SEVERITY_ORDER, SEVERITY_COLORS, OWASP_NAMES)
│       │   └── utils.ts            # Misc frontend utilities
│       ├── pages/              # Dashboard, ScanBuilder, Results,
│       │                       # Remediation, Reports, Settings, …
│       └── components/
└── python-workers/
    ├── garak/                  # Garak runner container
    ├── pyrit/                  # PyRIT runner container
    └── deepteam/               # DeepTeam runner container
```

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup` | First-run admin creation |
| POST | `/api/auth/register` | Register with invite code |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/invite` | Generate invite code (admin only) |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project details |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Archive project |

### Scans
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scans/catalog` | Plugin catalog + presets |
| GET | `/api/scans/stats` | Aggregated severity statistics |
| GET | `/api/scans/history` | Last 30 completed scans (trend chart data) |
| GET | `/api/scans/upcoming` | Scheduled & recurring scans widget |
| GET | `/api/scans` | List all scans |
| POST | `/api/scans` | Create + queue scan |
| GET | `/api/scans/:id` | Scan status |
| GET | `/api/scans/:id/results` | Scan findings |
| POST | `/api/scans/:id/cancel` | Cancel running scan |

### Results
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/results/scans/:scanId/summary` | Scan summary statistics |
| POST | `/api/results/scans/:scanId/narrative` | Generate AI executive summary |

### Remediation
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/remediation/scans/:scanId/generate` | Generate AI remediation plan |
| POST | `/api/remediation/scans/:scanId/verify` | Re-run only failed plugins to verify fixes |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/:scanId` | List reports for a scan |
| POST | `/api/reports/:scanId/generate` | Generate PDF/JSON report |
| GET | `/api/reports/:scanId/download/:reportId` | Download report file |

### Settings (admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/smtp` | SMTP configuration (password redacted) |
| PUT | `/api/settings/smtp` | Save SMTP settings |
| POST | `/api/settings/smtp/test` | Send a test email |
| GET | `/api/settings/remediation` | AI remediation provider config (API key redacted) |
| PUT | `/api/settings/remediation` | Save remediation provider settings |
| POST | `/api/settings/models` | Auto-detect available models for a provider |

### Connectivity
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/connectivity/check` | Pre-flight endpoint reachability + latency check |

### License
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/license` | Check license status |
| POST | `/api/license/activate` | Activate a license key |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | (required) | Secret for JWT signing — use `openssl rand -hex 64` |
| `DATABASE_URL` | `./data/eart.db` | SQLite path or Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REPORT_DIR` | `./data/reports` | Where PDF/JSON reports are stored |
| `RSA_PUBLIC_KEY_PATH` | `./keys/license_public.pem` | License validation public key |
| `ANTHROPIC_API_KEY` | — | Cloud fallback for AI summaries and remediation. Not required when a provider is configured in Settings or when using Ollama/OpenAI via project config |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Model to use when falling back to Anthropic API |
| `SMTP_HOST` | — | SMTP server for email notifications (can also be set via Settings UI) |
| `SMTP_PORT` | `587` | SMTP port (can also be set via Settings UI) |
| `SMTP_USER` | — | SMTP username (can also be set via Settings UI) |
| `SMTP_PASS` | — | SMTP password (can also be set via Settings UI) |
| `SMTP_FROM` | — | From address for notification emails (can also be set via Settings UI) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `OLLAMA_URL` | — | Override Ollama endpoint for Docker deployments (auto-detected when unset) |
| `EART_APP_URL` | — | Internal URL for worker→app communication (set automatically in docker-compose) |

---

## Scan Presets

| Preset | Plugins | Description |
|--------|---------|-------------|
| `quick` | 8 | Core vulnerability check — under 5 min |
| `owasp` | 20 | Full OWASP LLM Top 10 coverage |
| `full` | 41 | Everything — all 4 tools, all categories |

---

## Testing

EART has a full test suite across all layers.

### Backend tests (unit + integration)

```bash
npm test                    # run all tests once
npm run test:watch          # watch mode
npm run test:coverage       # with coverage report
```

Tests use Vitest with an in-memory SQLite database — no Redis or Docker required.

### Frontend tests

```bash
cd site
npm test                    # run all component tests
npm run test:watch          # watch mode
```

Tests use Vitest + React Testing Library in a jsdom environment.

### End-to-end tests

```bash
# Start the dev servers first:
npm run dev &
cd site && npm run dev &

# Then run E2E tests:
npm run test:e2e
```

E2E tests use Playwright against the live dev servers.

### CI

GitHub Actions runs type-check, backend tests, frontend tests, and a full build on every push and pull request. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Contributing

1. Fork the repository and create a feature branch
2. Make your changes with tests
3. Run `npm test && cd site && npm test` to verify
4. Ensure `npm run build:all` succeeds
5. Open a pull request

---

## License

MIT License — see [LICENSE](LICENSE).

A commercial license key unlocks unlimited concurrent scans and removes the "Powered by EART" footer. [Purchase at enterpriseairedteam.com](https://enterpriseairedteam.com).
