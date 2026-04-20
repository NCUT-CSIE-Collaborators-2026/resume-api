#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

local_file=".dev.vars.local"
secret_file=".dev.vars.secret"
out_file=".dev.vars"

if [[ ! -f "${local_file}" ]]; then
  echo "Missing ${local_file}. Create it from ${local_file}.example"
  exit 1
fi

if [[ ! -f "${secret_file}" ]]; then
  echo "Missing ${secret_file}. Create it from ${secret_file}.example"
  exit 1
fi

# Build wrangler-compatible .dev.vars from local + secret layers.
{
  cat "${local_file}"
  echo
  cat "${secret_file}"
} > "${out_file}"

echo "Generated ${out_file} from ${local_file} + ${secret_file}"
