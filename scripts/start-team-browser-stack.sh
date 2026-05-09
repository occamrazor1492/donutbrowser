#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_DIR="$ROOT_DIR/donut-sync"

export JWT_SECRET="${JWT_SECRET:-dev-change-me-local-only}"
export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me}"

echo "Starting Donut team browser stack"
echo "Project: $ROOT_DIR"
echo "Admin email: $ADMIN_EMAIL"
echo "Admin password: set via ADMIN_PASSWORD or local default"

if ! docker info >/dev/null 2>&1; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    echo "Docker daemon is not running. Opening Docker Desktop..."
    open -a Docker >/dev/null 2>&1 || true
  fi

  echo "Waiting for Docker daemon..."
  for _ in {1..60}; do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 3
  done
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is still unavailable. Start Docker Desktop and rerun this script." >&2
  exit 1
fi

cd "$SYNC_DIR"
docker compose up --build -d

echo "Waiting for donut-sync health endpoint..."
for _ in {1..60}; do
  if curl -fsS http://127.0.0.1:12342/health >/dev/null 2>&1; then
    echo "donut-sync is running: http://127.0.0.1:12342"
    echo "MinIO console: http://127.0.0.1:8988"
    exit 0
  fi
  sleep 2
done

echo "Containers started, but donut-sync health did not become ready in time." >&2
echo "Run: cd $SYNC_DIR && docker compose logs -f donut-sync" >&2
exit 1
