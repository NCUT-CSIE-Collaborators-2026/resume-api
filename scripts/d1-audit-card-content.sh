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

audit_json="$(npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, json_extract(payload, '$.card_content.cards[0].name') AS profile_name, json_extract(payload, '$.card_content.cards[0].headline') AS profile_headline, json_extract(payload, '$.card_content.cards[0].subtitle') AS profile_subtitle, json_extract(payload, '$.card_content.cards[1].text') AS intro30_text, json_extract(payload, '$.card_content.cards[2].text') AS intro60_text, json_array_length(payload, '$.card_content.cards[3].elements[0].groups') AS education_groups_count, json_array_length(payload, '$.card_content.cards[4].elements[0].groups') AS experience_groups_count, json_array_length(payload, '$.card_content.cards[5].elements[0].items') AS stack_items_count, json_extract(payload, '$.card_content.cards[6].title') AS projects_title, json_array_length(payload, '$.card_content.cards[6].elements[0].groups') AS projects_groups_count, json_extract(payload, '$.card_content.cards[7].title') AS verify_title, json_array_length(payload, '$.card_content.cards[7].elements[0].items') AS verify_items_count FROM resume_i18n_content ORDER BY lang_code;" --json)"

node --input-type=module - "$audit_json" <<'NODE'
const raw = process.argv[2] ?? '[]';
const parsed = JSON.parse(raw);
const resultRows = Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].results)
  ? parsed[0].results
  : [];

if (resultRows.length === 0) {
  console.error('Audit failed: no rows returned from D1');
  process.exit(1);
}

const toText = (value) => (typeof value === 'string' ? value.trim() : '');
const toCount = (value) => (typeof value === 'number' ? value : Number(value ?? 0));

const issues = [];

for (const row of resultRows) {
  const lang = toText(row.lang_code) || 'unknown';
  if (!toText(row.profile_name)) issues.push(`${lang}: missing profile_name`);
  if (!toText(row.profile_headline)) issues.push(`${lang}: missing profile_headline`);
  if (!toText(row.intro30_text)) issues.push(`${lang}: missing intro30_text`);
  if (!toText(row.intro60_text)) issues.push(`${lang}: missing intro60_text`);
  if (!toText(row.projects_title)) issues.push(`${lang}: missing projects_title`);
  if (!toText(row.verify_title)) issues.push(`${lang}: missing verify_title`);
  if (toCount(row.education_groups_count) <= 0) issues.push(`${lang}: education groups empty`);
  if (toCount(row.experience_groups_count) <= 0) issues.push(`${lang}: experience groups empty`);
  if (toCount(row.stack_items_count) <= 0) issues.push(`${lang}: stack items empty`);
  if (toCount(row.projects_groups_count) <= 0) issues.push(`${lang}: projects groups empty`);
  if (toCount(row.verify_items_count) <= 0) issues.push(`${lang}: verify items empty`);
}

console.log('Card content audit result:');
console.table(resultRows);

if (issues.length > 0) {
  console.error('\nAudit failed with issues:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log('\nAudit passed: all required card fields are populated.');
NODE
