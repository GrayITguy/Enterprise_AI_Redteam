# Enterprise AI Red Team Platform (EART) — Claude Code Guide

## Project Overview

EART is a self-hosted AI security testing dashboard that consolidates multiple red-teaming tools (Promptfoo, Garak, PyRIT, DeepTeam) into a single web interface. It provides 41 vulnerability tests covering OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22, Express, TypeScript (strict) |
| Frontend | React 18, Vite, Tailwind CSS, Radix UI |
| Database | SQLite (default) or PostgreSQL via Drizzle ORM |
| Job Queue | BullMQ backed by Redis 7 |
| AI | Anthropic SDK (Claude Haiku); optional Ollama for local models |
| Python Workers | Garak, PyRIT, DeepTeam — spawned as Docker containers |
| Scheduling | node-cron (polls every 5 min for recurring scans) |
| Auth | JWT (jsonwebtoken) + bcryptjs; roles: admin / analyst / viewer |

## Repository Layout

```
/
├── src/                        # Backend TypeScript source
│   ├── db/
│   │   └── schema.ts           # Drizzle table definitions
│   ├── server/
│   │   ├── config/
│   │   │   └── pluginCatalog.ts  # 41-plugin vulnerability catalog
│   │   ├── routes/             # Express route handlers
│   │   ├── services/
│   │   │   └── scheduler.ts    # Recurring scan orchestration
│   │   └── workers/
│   │       └── scanWorker.ts   # BullMQ job processor
│   └── index.ts                # Express entry point
├── site/                       # Frontend React application (Vite)
├── python-workers/             # Python security tool containers
│   ├── garak/
│   ├── pyrit/
│   └── deepteam/
├── data/                       # SQLite DB + report storage (gitignored)
├── logs/                       # Application logs (gitignored)
├── keys/                       # RSA license keys (gitignored)
├── scripts/                    # Build & utility scripts
├── docker-compose.yml          # 7-service orchestration
├── Dockerfile                  # Multi-stage: backend → frontend → runtime
├── drizzle.config.ts           # ORM configuration
└── .env.example                # All required environment variables
```

## Development Setup

### Prerequisites

- Node.js 20+
- Redis running locally (`redis-server`)
- Docker + Docker Compose v2 (for Python workers)

### Steps

```bash
# 1. Install dependencies
npm install
cd site && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env — set a strong JWT_SECRET (64+ chars at minimum)

# 3. Create required directories
mkdir -p data/reports keys logs

# 4. Run database migrations
npm run db:migrate

# 5. Start all three processes in separate terminals:
npm run dev          # Backend on :3000
cd site && npm run dev  # Frontend on :5173
npm run dev:worker   # BullMQ scan worker
```

The frontend dev server proxies `/api/*` to the backend automatically.

## Key npm Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Backend with hot reload (ts-node-dev) |
| `npm run dev:worker` | BullMQ scan worker with hot reload |
| `npm run build` | Compile TypeScript backend |
| `npm run build:all` | Build backend + frontend |
| `npm run db:migrate` | Apply pending Drizzle migrations |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:studio` | Open Drizzle Studio GUI |
| `npm run license:keygen` | Generate RSA key pair for license management |
| `npm start` | Run compiled production server |
| `npm run worker` | Run compiled production worker |

## Docker Deployment (Production)

```bash
cp .env.example .env  # Edit with production values
docker compose up -d  # App available at http://localhost:15500

# Optional: Python worker images (~2–3 GB each)
docker compose --profile workers build

# Optional: Ollama for local LLM support
docker compose --profile local-ai up -d
docker exec eart-ollama ollama pull llama3
```

## Environment Variables

Key variables from `.env.example`:

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Signing secret — 64+ chars |
| `DATABASE_URL` | No | SQLite path or Postgres URL |
| `REDIS_URL` | No | Default `redis://localhost:6379` |
| `ANTHROPIC_API_KEY` | No | Enables Claude AI features |
| `ANTHROPIC_MODEL` | No | Default `claude-haiku-4-5-20251001` |
| `REPORT_DIR` | No | Default `./data/reports` |
| `RSA_PUBLIC_KEY_PATH` | No | License validation public key |
| `SMTP_HOST/PORT/USER/PASS` | No | Email notification config |
| `CORS_ORIGIN` | No | Default `*` |
| `GARAK_IMAGE` / `PYRIT_IMAGE` / `DEEPTEAM_IMAGE` | No | Python worker Docker image names |

## Architecture Notes

### Scan Pipeline

1. User configures a scan via the frontend Scan Builder
2. Backend enqueues a BullMQ job in Redis
3. `scanWorker.ts` picks up the job and spawns the appropriate Python worker container
4. Python worker protocol: JSON config on **stdin** → JSONL results on **stdout**
5. Results are persisted to SQLite and surfaced in the dashboard

### Python Workers

Each worker (Garak, PyRIT, DeepTeam) is a separate Docker image. They are spawned on-demand — no long-running container required in development. Build images with:

```bash
docker compose --profile workers build
```

### AI-Powered Features

The remediation engine and executive summary generator call Claude (via Anthropic SDK) or a local Ollama instance. Both are optional; the platform is fully functional without them.

### License System

Uses RSA key-pair validation. Free-tier limits are enforced in code. Generate keys with `npm run license:keygen`. Keep `keys/` out of version control (already in `.gitignore`).

## Database

- **ORM:** Drizzle ORM
- **Schema:** `src/db/schema.ts`
- **Migrations:** stored in `drizzle/` directory, applied via `npm run db:migrate`
- **GUI:** `npm run db:studio` opens Drizzle Studio at `https://local.drizzle.studio`

After modifying `schema.ts`, always generate a new migration:
```bash
npm run db:generate
npm run db:migrate
```

## Code Conventions

- TypeScript strict mode is enabled — no implicit `any`
- ES modules (`"type": "module"` in package.json)
- Target: ES2022
- Backend routes live in `src/server/routes/`
- Frontend pages live in `site/src/pages/` (React Router v6)
- State management: Zustand stores in `site/src/stores/`
- Data fetching: TanStack Query hooks in `site/src/hooks/`

## Common Tasks

### Add a new vulnerability plugin

1. Add the plugin definition to `src/server/config/pluginCatalog.ts`
2. Handle the plugin ID in the appropriate Python worker or Promptfoo config builder
3. Update any preset templates (Quick / OWASP / Full) if appropriate

### Add a new API route

1. Create a handler in `src/server/routes/`
2. Register it in `src/index.ts` (or the router entry point)
3. Add the corresponding API call in `site/src/` (Axios + TanStack Query)

### Change the database schema

1. Edit `src/db/schema.ts`
2. Run `npm run db:generate` to create a migration file
3. Run `npm run db:migrate` to apply it

## Workflow

Before marking any task complete:

1. Run tests
2. Update `README.md` if behavior, setup, or usage changed
3. Update `CHANGELOG.md` with a brief entry
