#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote (web) sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "==> Installing backend dependencies..."
npm install

echo "==> Installing frontend dependencies..."
cd site && npm install && cd ..

echo "==> Creating required directories..."
mkdir -p data/reports keys logs

echo "==> Starting Redis..."
redis-server --daemonize yes --logfile /tmp/redis.log --port 6379 2>/dev/null || true
sleep 1

echo "==> Running database migrations..."
npm run db:migrate 2>/dev/null || npm run dev -- --once 2>/dev/null || true
# Schema is applied automatically in dev mode on first start; migration errors are handled by app

echo "==> Starting backend (port 3000)..."
tmux kill-session -t eart-backend 2>/dev/null || true
tmux new-session -d -s eart-backend -c "$CLAUDE_PROJECT_DIR" \
  "npm run dev 2>&1 | tee /tmp/backend.log"

echo "==> Starting frontend (port 5173)..."
tmux kill-session -t eart-frontend 2>/dev/null || true
tmux new-session -d -s eart-frontend -c "$CLAUDE_PROJECT_DIR/site" \
  "npm run dev -- --host 0.0.0.0 2>&1 | tee /tmp/frontend.log"

echo "==> Starting scan worker..."
tmux kill-session -t eart-worker 2>/dev/null || true
tmux new-session -d -s eart-worker -c "$CLAUDE_PROJECT_DIR" \
  "npm run dev:worker 2>&1 | tee /tmp/worker.log"

echo "==> Waiting for servers to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && \
     curl -sf http://localhost:5173/ >/dev/null 2>&1; then
    echo "==> Both servers are up."
    break
  fi
  sleep 1
done

echo "==> Session start complete. App available at http://localhost:5173"
