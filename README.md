# Enterprise AI Red Team Platform

**The missing unified self-hosted security testing dashboard for AI systems.**

Combines [Promptfoo](https://github.com/promptfoo/promptfoo), [Garak](https://github.com/leondz/garak), [PyRIT](https://github.com/Azure/PyRIT), and [DeepTeam](https://github.com/confident-ai/deepteam) into a single product that security teams will actually use.

- **Self-hosted** — your data never leaves your infrastructure
- **Air-gapped ready** — works with Ollama, no mandatory cloud
- **One command install** — `docker compose up -d`
- **41 vulnerability tests** — OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more

---

## Features

- **Dashboard** — severity charts, pass-rate trend (last 30 scans), upcoming scans widget, and a notification badge showing newly completed scans
- **Scan Builder** — 41-plugin catalog with full-text search and severity filters; choose from Quick, OWASP, or Full presets or hand-pick plugins
- **Scan Scheduler** — schedule one-off or recurring scans (daily / weekly / monthly) with email notifications (always / failure-only / never)
- **Results & AI Summary** — per-finding details with prompt/response/evidence, OWASP radar chart, tool breakdown, and a Claude-powered executive summary
- **Reports** — generate and download PDF or JSON reports per scan
- **License Management** — free tier included; activate a commercial license key for unlimited concurrent scans
- **Team Access** — JWT-based auth with admin / analyst / viewer roles and invite-code registration

---

## Quick Start

### Prerequisites
- Docker + Docker Compose v2
- 4 GB RAM minimum (8 GB recommended for running local models)

### 1. Clone and configure

```bash
git clone https://github.com/yourusername/enterpriseairedteam.git
cd enterpriseairedteam
cp .env.example .env
# Edit .env — at minimum, set a strong JWT_SECRET
```

### 2. Start the platform

```bash
docker compose up -d
```

Visit **http://localhost:15500** and complete the setup wizard to create your admin account.

### 3. (Optional) Build Python security testing workers

The platform uses containerized Python tools for advanced testing:

```bash
# Build all three worker images (~2-3 GB total)
docker compose --profile workers build
```

Workers are launched on-demand by the platform when running scans. You only need them if you want to use Garak, PyRIT, or DeepTeam tests.

### 4. (Optional) Run local AI models with Ollama

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
    ├── Nodemailer → SMTP email notifications
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
│   │   │   └── pluginCatalog.ts # 41 plugins + presets
│   │   ├── middleware/
│   │   │   ├── auth.ts          # JWT middleware
│   │   │   └── errorHandler.ts
│   │   ├── routes/             # API route handlers
│   │   ├── services/           # Business logic
│   │   │   ├── scanner.ts      # Scan orchestrator
│   │   │   ├── dockerRunner.ts # Python worker spawner
│   │   │   ├── emailService.ts # Nodemailer notifications
│   │   │   ├── scheduler.ts    # Recurring scan scheduler
│   │   │   └── reportGenerator.ts
│   │   └── workers/
│   │       └── scanWorker.ts   # BullMQ worker process
│   ├── db/
│   │   ├── schema.ts           # Drizzle table definitions
│   │   └── index.ts
│   └── license-validator.ts    # Offline RSA license check
├── site/                       # React frontend (Vite)
│   └── src/
│       ├── pages/
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

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/:scanId` | List reports for a scan |
| POST | `/api/reports/:scanId/generate` | Generate PDF/JSON report |
| GET | `/api/reports/:scanId/download/:reportId` | Download report file |

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
| `ANTHROPIC_API_KEY` | — | API key for Claude-powered AI summaries |
| `SMTP_HOST` | — | SMTP server for email notifications |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From address for notification emails |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |

---

## Scan Presets

| Preset | Plugins | Description |
|--------|---------|-------------|
| `quick` | 8 | Core vulnerability check — under 5 min |
| `owasp` | 20 | Full OWASP LLM Top 10 coverage |
| `full` | 41 | Everything — all 4 tools, all categories |

---

## License

MIT License — see [LICENSE](LICENSE).

A commercial license key unlocks unlimited concurrent scans and removes the "Powered by EART" footer. [Purchase at enterpriseairedteam.com](https://enterpriseairedteam.com).
