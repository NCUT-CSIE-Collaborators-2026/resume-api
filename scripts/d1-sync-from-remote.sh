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

backup_dir=".tmp"
backup_file="${backup_dir}/resume-api-db-remote.sql"
import_file="${backup_dir}/resume-api-db-remote.import.sql"

mkdir -p "${backup_dir}"

echo "[1/5] Export remote D1 to ${backup_file}"
npx wrangler d1 export resume-api-db --remote --output "${backup_file}"

echo "[2/5] Reset local table to avoid CREATE TABLE conflict"
npx wrangler d1 execute resume-api-db --local --command "DROP INDEX IF EXISTS idx_resume_i18n_content_updated_at; DROP TABLE IF EXISTS resume_i18n_content;"

echo "[3/5] Sanitize export SQL for local import compatibility"
# Wrangler export can include sqlite_sequence statements. Local D1 import may fail if sqlite_sequence is absent.
grep -v "sqlite_sequence" "${backup_file}" > "${import_file}"

echo "[4/5] Import export file into local D1"
npx wrangler d1 execute resume-api-db --local --file "${import_file}"

echo "[5/5] Compare local and remote row status"

echo "Remote status:"
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, updated_at, length(payload) AS payload_size FROM resume_i18n_content ORDER BY lang_code;" --yes

echo "Local status:"
npx wrangler d1 execute resume-api-db --local --command "SELECT lang_code, updated_at, length(payload) AS payload_size FROM resume_i18n_content ORDER BY lang_code;"

echo "Sync from remote completed."
