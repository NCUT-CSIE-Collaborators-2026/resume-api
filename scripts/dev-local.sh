#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"

cleanup() {
  local pids
  pids="$(ss -ltnp 2>/dev/null | grep ":${PORT}" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' || true)"
  if [[ -n "${pids}" ]]; then
    echo "Stopping process on port ${PORT}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

# Free the port before starting to avoid stale workerd conflicts.
cleanup

echo "Starting wrangler dev on ${HOST}:${PORT}"
exec npx wrangler dev --local --ip "${HOST}" --port "${PORT}"
