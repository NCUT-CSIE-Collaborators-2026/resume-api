#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env.wrangler.local ]]; then
  # shellcheck disable=SC1091
  source .env.wrangler.local
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID"
  echo "Create and fill .env.wrangler.local, then run: source .env.wrangler.local"
  exit 1
fi

if [[ "${CLOUDFLARE_API_TOKEN}" == "your_token_here" || "${CLOUDFLARE_ACCOUNT_ID}" == "your_account_id_here" ]]; then
  echo "Detected placeholder credentials in .env.wrangler.local"
  echo "Replace your_token_here / your_account_id_here with real values"
  exit 1
fi

echo "Checking Cloudflare auth..."
npx wrangler whoami

echo "Checking D1 list..."
npx wrangler d1 list

echo "Auth check passed."
