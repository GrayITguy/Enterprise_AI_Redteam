# Enterprise AI Red Team Platform

**Self-hosted AI security testing for teams that can't afford to get it wrong.**

I am not reinventing the wheel with this. I found the top rated AI Red-Team tools and just built an easier way to use them all with one simple set up. 
Please star and use. Feedback is 100% always welcome and suggestions for improvement. 

EART consolidates four best-in-class open-source red-teaming tools — [Promptfoo](https://github.com/promptfoo/promptfoo), [Garak](https://github.com/leondz/garak), [PyRIT](https://github.com/Azure/PyRIT), and [DeepTeam](https://github.com/confident-ai/deepteam) — into a single dashboard your security team will actually use.

- **Self-hosted** — your data never leaves your infrastructure
- **Air-gapped ready** — works with Ollama, no mandatory cloud calls
- **One command install** — `bash scripts/install.sh` handles everything
- **82 vulnerability tests** — OWASP LLM Top 10, prompt injection, jailbreaks, PII extraction, and more

<img width="815" height="395" alt="Dashboard" src="https://github.com/user-attachments/assets/c98fea31-9d4a-4346-93c2-4ef0bdd48bb1" />
<img width="812" height="370" alt="Scan Builder" src="https://github.com/user-attachments/assets/9e79717f-41d8-4262-9be7-ede11e7b25e4" />
<img width="816" height="394" alt="Results" src="https://github.com/user-attachments/assets/b88b614a-747f-48d6-b7f4-b22f453896e3" />
<img width="815" height="391" alt="Remediation" src="https://github.com/user-attachments/assets/1b0ed29b-f58f-43c8-9523-a8be403fa0ab" />

---

## Free & Open Source

EART is **100% free and open source** under the MIT License — every feature, forever. Unlimited scans, all presets, all 82 plugins, clean PDF reports, email notifications, and the AI remediation engine are available to everyone with no license keys, tiers, or restrictions of any kind.

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
mkdir -p data/reports logs
docker compose build
docker compose up -d
```

Visit **http://localhost:15500** and complete the setup wizard.

> **Container hardening.** The app and worker run as a non-root user and reach
> the Docker API through a restricted [socket proxy](https://github.com/Tecnativa/docker-socket-proxy)
> (only the container/image endpoints needed to launch Python workers) rather
> than bind-mounting `/var/run/docker.sock` directly, so a compromise of the app
> can't drive the full host Docker API. The proxy is the only service that
> touches the socket, and it publishes no host port.

### (Optional) Local AI with Ollama

```bash
docker compose --profile local-ai up -d
docker exec eart-ollama ollama pull llama3
```

Then create a project with `Provider: Ollama` and target URL `http://ollama:11434`.

---

## Features

- **Dashboard** — severity charts, 30-scan pass-rate trend, upcoming scans widget, notification badge
- **Scan Builder** — 82-plugin catalog with search and severity filters; Quick, OWASP, and Full presets; pre-flight connectivity check
- **Scan Scheduler** — one-off or recurring scans (daily / weekly / monthly) with email notifications
- **Results & AI Summary** — per-finding detail with prompt/response/evidence, OWASP radar chart, AI-generated executive summary
- **Remediation Engine** — AI-generated remediation plans, risk scoring (0-100), root-cause analysis, copy-pasteable hardening configs, one-click verification re-scans — works fully offline via Ollama
- **Settings** — configure AI provider (Ollama, OpenAI, Anthropic, or custom endpoint with model auto-detection) and SMTP from the web UI
- **Endpoint Auto-Bridge** — zero-config local model scanning; `localhost` endpoints automatically bridged into Docker workers
- **Reports** — PDF and JSON export per scan
- **Team Access** — JWT auth with admin / analyst / viewer base tiers, invite-code registration, and **custom roles** that grant fine-grained permissions (e.g. `scan:create`, `audit:read`) on top of a base tier — managed from Settings
- **Enterprise IAM (optional)** — OIDC and SAML 2.0 single sign-on, SCIM 2.0 user provisioning/deprovisioning, and IdP group → role mapping; all feature-flagged off until configured (see [`.env.example`](.env.example))
- **Governance & compliance** — append-only audit log, pre-run scan cost estimate + hard call ceiling, target-authorization allow-list, per-target rate limiting, time-based data-retention purge + response minimization, and MITRE ATLAS / NIST AI RMF framework mappings on findings

---

## Scan Presets

| Preset | Plugins | Coverage |
|--------|---------|----------|
| Quick | 10 | Core vulnerabilities — prompt injection, jailbreaks, PII, toxicity |
| OWASP | 22 | All 10 OWASP LLM Top 10 categories |
| Full | 82 | Every plugin across Promptfoo, Garak, PyRIT, and DeepTeam |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 24, Express 5, TypeScript (strict) |
| Frontend | React 19, Vite 8, Tailwind CSS 4, Radix UI |
| Database | SQLite (default) or PostgreSQL via Drizzle ORM |
| Job Queue | BullMQ + Redis 8 |
| AI | Anthropic SDK (Claude Haiku); optional Ollama for local models |
| Python Workers | Garak 0.14+, PyRIT 0.14+, DeepTeam 1.0+ — Docker containers |
| Auth | JWT + bcrypt; base tiers admin / analyst / viewer + custom roles with fine-grained permissions |

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

### Which engines actually run

Being precise about what runs under the hood today:

| Engine | Status |
|--------|--------|
| **Garak** | **Runs the real [garak](https://github.com/NVIDIA/garak) tool** — the worker drives garak's probes against your target via its REST generator and reports garak's own detector verdicts. |
| **DeepTeam** | **Runs the real [deepteam](https://github.com/confident-ai/deepteam) framework** when an independent evaluator LLM is configured — deepteam's Vulnerability classes and attack enhancements (PromptInjection, Roleplay, …) are driven against the target, with an LLM simulator generating attacks and an LLM evaluator judging responses; deepteam's own metric verdicts are reported. Falls back to EART's labelled heuristic probes when no evaluator LLM is available. |
| **PyRIT** | **Runs Microsoft's real [PyRIT](https://github.com/Azure/PyRIT) toolkit** when an independent evaluator LLM is configured — each plugin maps to a real PyRIT attack strategy (PromptSendingAttack, SkeletonKeyAttack, ManyShotJailbreakAttack, FlipAttack, CrescendoAttack, TAPAttack, PAIRAttack) driven against the target, with a real Scorer (run by the evaluator LLM) deciding whether the objective was achieved; PyRIT's own AttackOutcome is reported. Falls back to EART's labelled heuristic probes when no evaluator LLM is available. |
| **Promptfoo** | Cloud providers (OpenAI/Anthropic/Azure) run promptfoo's real `evaluate` harness; the Ollama/custom paths deliberately use EART's own attack library (`PLUGIN_ATTACKS`) because promptfoo's HTTP provider is unreliable on non-standard response shapes. Grading is regex + the [AI judge](#grading-regex--optional-ai-judge). |

> **Honesty note:** **Garak**, **DeepTeam**, and **PyRIT** invoke real external engines (DeepTeam and PyRIT need an evaluator LLM — see below). **Promptfoo** uses its real harness for cloud providers and EART's own attacks (with the AI judge) elsewhere. All four are either real engines or honestly labelled.

#### Grading: regex + optional AI judge

EART's built-in attacks were graded purely by regex `failPattern`: a match on an
exploit marker (e.g. `CONFIRMED_INJECTED`) meant "compromised", no match meant
"safe". Regex is precise but brittle — a model that complies *in its own words*,
or leaks a system prompt phrased differently, slips past the pattern and is
scored as a false all-clear, the worst failure mode for a red-teaming tool.

When an **independent AI provider** is configured (Settings → AI Remediation, or
`ANTHROPIC_API_KEY`), every response the regex marked "safe" is re-examined by a
semantic **judge** that decides whether the model actually did the unsafe thing.
The judge can only ever escalate a regex pass to a finding — a matched exploit
marker is always honoured — and it never uses the target model to grade itself.
With no judge configured, grading falls back to regex-only. Disable the judge
with `SCAN_JUDGE=off`.

The **same independent provider** powers DeepTeam's and PyRIT's real engines: it
is the LLM that simulates/orchestrates the adversarial attacks and scores the
responses. With no provider configured, both fall back to EART's labelled
heuristic probes.

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

- Node.js 22+ (24 LTS recommended)
- Redis (`docker run -d -p 6379:6379 redis:8-alpine`)

```bash
npm install && cd site && npm install && cd ..
cp .env.example .env
mkdir -p data/reports logs
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
| `DATABASE_URL` | `./data/eart.db` | A `postgres://` / `postgresql://` URL selects PostgreSQL; any other value is a SQLite file path (`:memory:` supported). Tables are created automatically on first boot. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REPORT_DIR` | `./data/reports` | PDF/JSON report storage |
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

> **Optional enterprise / governance variables** are documented in full in [`.env.example`](.env.example), grouped by area: OIDC (`OIDC_*`), SAML (`SAML_*`), SCIM (`SCIM_TOKEN`), group→role mapping (`SSO_GROUP_ROLE_MAP`, `OIDC_GROUPS_CLAIM`, `SAML_GROUPS_ATTRIBUTE`), data retention (`DATA_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`, `SCAN_STORE_RESPONSES`), scan governance (`SCAN_MAX_TARGET_CALLS`, `SCAN_TARGET_RATE_LIMIT`, `TARGET_ALLOWLIST`), the AI judge (`SCAN_JUDGE`), and engine tuning (`GARAK_PROMPT_CAP`, `PYRIT_*`, `DEEPTEAM_*`). All are off/safe by default.

---

## API Reference

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/setup` | First-run admin creation |
| POST | `/api/auth/register` | Register with invite code |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Current user + effective permissions |
| POST | `/api/auth/invite` | Generate invite code (admin) |
| GET | `/api/auth/sso/status` | Which SSO methods (OIDC / SAML) are enabled |
| GET | `/api/auth/oidc/login` · `/oidc/callback` | OIDC SSO (when configured) |
| GET/POST | `/api/auth/saml/login` · `/saml/callback` · `/saml/metadata` | SAML 2.0 SSO (when configured) |

### Users & Roles (admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users |
| PATCH | `/api/users/:id` | Change base role and/or assign a custom role (`{ role?, customRoleId? }`) |
| DELETE | `/api/users/:id` | Delete a user (cascades their data; last-admin guarded) |
| GET | `/api/roles/permissions` | Fine-grained permission catalog + built-in tier mappings |
| GET · POST | `/api/roles` | List / create custom roles |
| GET · PATCH · DELETE | `/api/roles/:id` | Read / update / delete a custom role |

> SCIM 2.0 provisioning is served at `/scim/v2/*` (bearer-token auth via `SCIM_TOKEN`; 404 when unset).

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
| GET | `/api/scans/catalog` | Plugin catalog + presets (with ATLAS/NIST mappings) |
| GET | `/api/scans/estimate` | Pre-run upper-bound target-call estimate |
| GET | `/api/scans/stats` | Aggregated severity stats |
| GET | `/api/scans/history` | Last 30 scans (trend data) |
| GET | `/api/scans/upcoming` | Scheduled & recurring scans |
| GET | `/api/scans` | List all scans |
| POST | `/api/scans` | Create + queue scan (refused if estimate exceeds `SCAN_MAX_TARGET_CALLS`) |
| GET | `/api/scans/:id` | Scan status |
| GET | `/api/scans/:id/results` | Scan findings (paginated) |
| GET | `/api/scans/:id/events` | Live progress stream (SSE) |
| GET | `/api/scans/:id/diff` | Before/after comparison vs. an original scan |
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

### Audit & Data Governance (admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit` | Read/filter the append-only audit log (requires the `audit:read` permission) |
| GET | `/api/retention` | Active data-retention configuration |
| POST | `/api/retention/purge` | Run a retention purge on demand |

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

CI runs type-check, backend/frontend/Python-worker tests, a production dependency-audit gate (`npm run audit:ci` — fails on high/critical advisories), a live-model smoke test (skips without secrets), and the build on every push/PR. The heavy Garak/PyRIT/DeepTeam Docker images build in a separate path-filtered [Worker Images](.github/workflows/worker-images.yml) workflow. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## License

MIT License — see [LICENSE](LICENSE).

EART is free and open-source software. Every feature is available to everyone, always — there are no paid tiers, license keys, or usage limits. Contributions are welcome!
