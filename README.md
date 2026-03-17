# Enterprise AI Red Team Platform

**Self-hosted AI security testing for teams that can't afford to get it wrong.**

EART consolidates four best-in-class open-source red-teaming tools — [Promptfoo](https://github.com/promptfoo/promptfoo), [Garak](https://github.com/leondz/garak), [PyRIT](https://github.com/Azure/PyRIT), and [DeepTeam](https://github.com/confident-ai/deepteam) — into a single dashboard your security team will actually use.

- **Self-hosted** — your data never leaves your infrastructure
- **Air-gapped ready** — works with Ollama, no mandatory cloud calls
- **One command install** — `bash scripts/install.sh` handles everything
- **60 vulnerability tests** — OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more

<img width="815" height="395" alt="Dashboard" src="https://github.com/user-attachments/assets/c98fea31-9d4a-4346-93c2-4ef0bdd48bb1" />
<img width="812" height="370" alt="Scan Builder" src="https://github.com/user-attachments/assets/9e79717f-41d8-4262-9be7-ede11e7b25e4" />
<img width="816" height="394" alt="Results" src="https://github.com/user-attachments/assets/b88b614a-747f-48d6-b7f4-b22f453896e3" />
<img width="815" height="391" alt="Remediation" src="https://github.com/user-attachments/assets/1b0ed29b-f58f-43c8-9523-a8be403fa0ab" />

---

## Free vs Pro

EART is fully functional on the free tier. A one-time license key unlocks everything.

| | Free | Pro ($79 one-time) |
|---|---|---|
| Scans per month | 5 | Unlimited |
| Scan presets | Quick (10 plugins) | Quick + OWASP + Full (60 plugins) |
| PDF reports | Watermarked | Clean |
| Email notifications | — | Included |
| AI remediation engine | Included | Included |
| Ollama / local models | Included | Included |
| Team roles (admin/analyst/viewer) | Included | Included |

[Purchase a license at enterpriseairedteam.com](https://enterpriseairedteam.com)

---

## Quick Start

### Prerequisites

- Docker + Docker Compose v2
- 4 GB RAM minimum (8 GB recommended for local models)

### Linux / macOS

```bash
git clone https://github.com/grayitguy/enterpriseairedteam.git
cd enterpriseairedteam
bash scripts/install.sh
```

### Windows

```bat
git clone https://github.com/grayitguy/enterpriseairedteam.git
cd enterpriseairedteam
scripts\install.bat
```

### Manual

```bash
git clone https://github.com/grayitguy/enterpriseairedteam.git
cd enterpriseairedteam
cp .env.example .env        # Edit .env — set JWT_SECRET (openssl rand -hex 32)
mkdir -p data/reports keys logs
docker compose build
docker compose up -d
```

Visit **http://localhost:15500** and complete the setup wizard.

### (Optional) Local AI with Ollama

```bash
docker compose --profile local-ai up -d
docker exec eart-ollama ollama pull llama3
```

Then create a project with `Provider: Ollama` and target URL `http://ollama:11434`.

---

## Features

- **Dashboard** — severity charts, 30-scan pass-rate trend, upcoming scans widget, notification badge
- **Scan Builder** — 60-plugin catalog with search and severity filters; Quick, OWASP, and Full presets; pre-flight connectivity check
- **Scan Scheduler** — one-off or recurring scans (daily / weekly / monthly) with email notifications
- **Results & AI Summary** — per-finding detail with prompt/response/evidence, OWASP radar chart, AI-generated executive summary
- **Remediation Engine** — AI-generated remediation plans, risk scoring (0-100), root-cause analysis, copy-pasteable hardening configs, one-click verification re-scans — works fully offline via Ollama
- **Settings** — configure AI provider (Ollama, OpenAI, Anthropic, or custom endpoint with model auto-detection) and SMTP from the web UI
- **Endpoint Auto-Bridge** — zero-config local model scanning; `localhost` endpoints automatically bridged into Docker workers
- **Reports** — PDF and JSON export per scan
- **Team Access** — JWT auth with admin / analyst / viewer roles and invite-code registration
- **License Management** — free tier included; activate a key to unlock unlimited scans

---

## Scan Presets

| Preset | Plugins | Coverage |
|--------|---------|----------|
| Quick | 10 | Core vulnerabilities — prompt injection, jailbreaks, PII, toxicity |
| OWASP | 22 | All 10 OWASP LLM Top 10 categories |
| Full | 60 | Every plugin across Promptfoo, Garak, PyRIT, and DeepTeam |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 22, Express 5, TypeScript (strict) |
| Frontend | React 19, Vite 7, Tailwind CSS 4, Radix UI |
| Database | SQLite (default) or PostgreSQL via Drizzle ORM |
| Job Queue | BullMQ + Redis 7 |
| AI | Anthropic SDK (Claude Haiku); optional Ollama for local models |
| Python Workers | Garak 0.14+, PyRIT 0.11+, DeepTeam — Docker containers |
| Auth | JWT + bcrypt; roles: admin / analyst / viewer |

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
    ├── Scheduler → polls every 5 min for recurring scans
    ├── Nodemailer → SMTP (env vars or admin-configured)
    ├── AI Provider → shared service for remediation & summaries
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

## Development Mode

### Prerequisites

- Node.js 22+
- Redis (`docker run -d -p 6379:6379 redis:7-alpine`)

```bash
npm install && cd site && npm install && cd ..
cp .env.example .env
mkdir -p data/reports keys logs
npm run db:migrate

# Three terminals:
npm run dev              # Backend on :3000
cd site && npm run dev   # Frontend on :5173
npm run dev:worker       # BullMQ worker
```

Visit **http://localhost:5173** — proxied to backend at :3000.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(required)* | Secret for JWT signing — `openssl rand -hex 64` |
| `DATABASE_URL` | `./data/eart.db` | SQLite path or Postgres URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REPORT_DIR` | `./data/reports` | PDF/JSON report storage |
| `RSA_PUBLIC_KEY_PATH` | `./keys/license_public.pem` | License validation public key |
| `ANTHROPIC_API_KEY` | — | Cloud fallback for AI features (not required with Ollama or Settings-configured provider) |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Anthropic model when using API key fallback |
| `OLLAMA_URL` | *(auto-detected)* | Override Ollama endpoint for Docker deployments |
| `OLLAMA_TIMEOUT` | `900` | Ollama request timeout in seconds (15 min default) |
| `SMTP_HOST` | — | SMTP server (also configurable via Settings UI) |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` / `SMTP_PASS` | — | SMTP credentials |
| `SMTP_FROM` | — | From address for notifications |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `GARAK_IMAGE` | `eart-garak:latest` | Garak Docker image |
| `PYRIT_IMAGE` | `eart-pyrit:latest` | PyRIT Docker image |
| `DEEPTEAM_IMAGE` | `eart-deepteam:latest` | DeepTeam Docker image |

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup` | First-run admin creation |
| POST | `/api/auth/register` | Register with invite code |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/invite` | Generate invite code (admin) |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Get project |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Archive project |

### Scans
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scans/catalog` | Plugin catalog + presets |
| GET | `/api/scans/stats` | Aggregated severity stats |
| GET | `/api/scans/history` | Last 30 scans (trend data) |
| GET | `/api/scans/upcoming` | Scheduled & recurring scans |
| GET | `/api/scans` | List all scans |
| POST | `/api/scans` | Create + queue scan |
| GET | `/api/scans/:id` | Scan status |
| GET | `/api/scans/:id/results` | Scan findings |
| POST | `/api/scans/:id/cancel` | Cancel running scan |

### Results
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/results/scans/:scanId/summary` | Scan summary stats |
| POST | `/api/results/scans/:scanId/narrative` | Generate AI executive summary |

### Remediation
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/remediation/scans/:scanId/generate` | Generate AI remediation plan |
| POST | `/api/remediation/scans/:scanId/verify` | Re-run failed plugins to verify fixes |

### Reports
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/reports/:scanId` | List reports for a scan |
| POST | `/api/reports/:scanId/generate` | Generate PDF/JSON report |
| GET | `/api/reports/:scanId/download/:reportId` | Download report |

### Settings (admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/smtp` | SMTP config (password redacted) |
| PUT | `/api/settings/smtp` | Save SMTP settings |
| POST | `/api/settings/smtp/test` | Send test email |
| GET | `/api/settings/remediation` | AI provider config (key redacted) |
| PUT | `/api/settings/remediation` | Save AI provider settings |
| POST | `/api/settings/models` | Auto-detect models for provider |

### Connectivity
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/connectivity/check` | Pre-flight endpoint reachability check |

### License
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/license` | License status |
| POST | `/api/license/activate` | Activate license key |

---

## Testing

```bash
# Backend
npm test                    # all tests
npm run test:watch          # watch mode
npm run test:coverage       # with coverage

# Frontend
cd site && npm test

# E2E (start dev servers first)
npm run test:e2e
```

CI runs type-check, tests, and build on every push/PR. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## License

MIT License — see [LICENSE](LICENSE).

EART is open source. The free tier is fully functional. A one-time commercial license key ($79) unlocks unlimited scans, all presets, clean PDF reports, and email notifications.

[Purchase at enterpriseairedteam.com](https://enterpriseairedteam.com)
