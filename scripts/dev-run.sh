#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

cleanup() {
  rm -f .dev.vars
}

trap cleanup EXIT INT TERM

bash ./scripts/dev-vars-compose.sh

echo "Starting wrangler dev"
npx wrangler dev
