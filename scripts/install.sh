#!/usr/bin/env bash
# Enterprise AI Red Team Platform — One-Command Installer
# Usage: bash scripts/install.sh
set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BOLD}${BLUE}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║  Enterprise AI Red Team Platform — Setup   ║${NC}"
  echo -e "${BOLD}${BLUE}╚════════════════════════════════════════════╝${NC}"
  echo ""
}

step() { echo -e "${BLUE}==>${NC} ${BOLD}$1${NC}"; }
ok()   { echo -e "${GREEN}✔${NC}  $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✘${NC}  $1"; exit 1; }

# ─── Prerequisite checks ─────────────────────────────────────────────────────

check_prereqs() {
  step "Checking prerequisites..."

  if ! command -v docker &>/dev/null; then
    fail "Docker is not installed. Install Docker Desktop or Docker Engine: https://docs.docker.com/get-docker/"
  fi
  ok "Docker found: $(docker --version | head -1)"

  # Check Docker Compose v2 (either plugin or standalone)
  if docker compose version &>/dev/null 2>&1; then
    ok "Docker Compose v2 found"
  elif command -v docker-compose &>/dev/null; then
    warn "docker-compose v1 found. Please upgrade to Docker Compose v2."
    warn "See: https://docs.docker.com/compose/migrate/"
    fail "Docker Compose v2 required (use 'docker compose' not 'docker-compose')"
  else
    fail "Docker Compose is not installed. It comes bundled with Docker Desktop."
  fi

  if ! docker info &>/dev/null; then
    fail "Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker"
  fi
  ok "Docker daemon is running"
}

# ─── Environment setup ───────────────────────────────────────────────────────

setup_env() {
  step "Configuring environment..."

  if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
      fail ".env.example not found. Are you running this from the project root?"
    fi
    cp .env.example .env
    ok "Created .env from .env.example"

    # Generate a strong random JWT_SECRET
    local jwt_secret
    if command -v openssl &>/dev/null; then
      jwt_secret=$(openssl rand -hex 32)
    elif command -v python3 &>/dev/null; then
      jwt_secret=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    else
      # Fallback: combine timestamp + random chars
      jwt_secret=$(date +%s%N | sha256sum | head -c 64 2>/dev/null || date +%s%N | md5sum | head -c 64)
    fi

    # Replace the placeholder JWT_SECRET in .env
    if command -v sed &>/dev/null; then
      sed -i.bak "s|JWT_SECRET=.*|JWT_SECRET=${jwt_secret}|" .env && rm -f .env.bak
    fi
    ok "Generated secure JWT_SECRET (64 hex chars)"
    warn "Review .env and add your ANTHROPIC_API_KEY for AI-powered features"
  else
    ok ".env already exists — skipping generation"
    warn "If you want to reset the configuration, delete .env and re-run this script"
  fi

  # Create required directories
  mkdir -p data/reports keys logs
  ok "Created required directories (data/, keys/, logs/)"
}

# ─── Build images ────────────────────────────────────────────────────────────

build_images() {
  step "Building Docker images (app + Python security workers)..."
  echo "   This takes 3–8 minutes on first run while dependencies are downloaded."
  echo "   Subsequent runs use the Docker layer cache and complete in seconds."
  echo ""

  if ! docker compose build; then
    fail "Docker image build failed. Check the output above for details."
  fi
  ok "All images built successfully"
}

# ─── Start services ──────────────────────────────────────────────────────────

start_services() {
  step "Removing any existing containers to avoid name conflicts..."
  docker compose down --remove-orphans 2>/dev/null || true
  ok "Existing containers removed"

  step "Starting services..."
  docker compose up -d
  ok "Services started"
}

# ─── Health check ────────────────────────────────────────────────────────────

wait_healthy() {
  step "Waiting for the platform to be ready..."
  local max_attempts=20
  local attempt=0

  while [ $attempt -lt $max_attempts ]; do
    if curl -sf http://localhost:15500/api/health &>/dev/null; then
      ok "Platform is healthy!"
      return 0
    fi
    attempt=$((attempt + 1))
    echo -n "."
    sleep 3
  done

  echo ""
  warn "Health check timed out after $((max_attempts * 3))s."
  warn "The app may still be starting. Check logs: docker compose logs -f app"
  return 1
}

# ─── Print success message ───────────────────────────────────────────────────

print_success() {
  echo ""
  echo -e "${BOLD}${GREEN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║           Setup Complete!                  ║${NC}"
  echo -e "${BOLD}${GREEN}╚════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Platform URL:${NC}  http://localhost:15500"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo "    1. Visit the URL above in your browser"
  echo "    2. Complete the setup wizard to create your admin account"
  echo "    3. Create a project, configure your target AI model"
  echo "    4. Run your first security scan"
  echo ""
  echo -e "  ${BOLD}Useful commands:${NC}"
  echo "    docker compose logs -f          — live logs"
  echo "    docker compose ps               — service status"
  echo "    docker compose down             — stop the platform"
  echo "    bash scripts/install.sh         — re-run setup"
  echo ""
  echo -e "  ${BOLD}Optional AI features:${NC}"
  echo "    Add ANTHROPIC_API_KEY to .env for AI-powered remediation"
  echo "    Add SMTP_HOST/USER/PASS for email notifications"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  print_header
  check_prereqs
  setup_env
  build_images
  start_services
  wait_healthy || true
  print_success
}

main "$@"
