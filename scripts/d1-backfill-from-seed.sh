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

seed_file=".tmp/backfill-seed.json"
repair_file=".tmp/d1-backfill-from-seed.sql"

if [[ ! -f "${seed_file}" ]]; then
  echo "Missing seed file: ${seed_file}"
  exit 1
fi

node --input-type=module <<'NODE'
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const seed = JSON.parse(fs.readFileSync('.tmp/backfill-seed.json', 'utf8'));

const d1Raw = execSync(
  "npx wrangler d1 execute resume-api-db --remote --command \"SELECT lang_code, payload, updated_at FROM resume_i18n_content ORDER BY lang_code;\" --json",
  { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);

const d1Parsed = JSON.parse(d1Raw);
const rows = Array.isArray(d1Parsed)
  ? (Array.isArray(d1Parsed[0]?.results) ? d1Parsed[0].results : [])
  : (Array.isArray(d1Parsed?.results) ? d1Parsed.results : []);

if (!Array.isArray(rows) || rows.length === 0) {
  throw new Error('Unable to read remote D1 rows for backfill');
}

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const isBlank = (value) =>
  value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);

const mergeStringArray = (targetItems, seedItems) => {
  const out = [...targetItems];
  for (const item of seedItems) {
    if (typeof item !== 'string') continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
};

const mergeObjectArrayByJson = (targetItems, seedItems) => {
  const out = [...targetItems];
  const existing = new Set(targetItems.map((item) => JSON.stringify(item)));
  for (const item of seedItems) {
    const key = JSON.stringify(item);
    if (!existing.has(key)) {
      out.push(item);
      existing.add(key);
    }
  }
  return out;
};

const mergeGroupItems = (targetItems, seedItems) => {
  const out = deepClone(targetItems);
  const byValue = new Set(
    out
      .map((item) => (asObject(item)?.value ?? ''))
      .filter((value) => typeof value === 'string' && value.length > 0),
  );

  for (const rawSeedItem of seedItems) {
    const seedItem = asObject(rawSeedItem);
    if (!seedItem) continue;
    const value = typeof seedItem.value === 'string' ? seedItem.value : '';
    if (!value) continue;
    if (!byValue.has(value)) {
      out.push(deepClone(seedItem));
      byValue.add(value);
    }
  }

  return out;
};

const mergeGroups = (targetGroups, seedGroups) => {
  const out = deepClone(targetGroups);

  for (const rawSeedGroup of seedGroups) {
    const seedGroup = asObject(rawSeedGroup);
    if (!seedGroup) continue;

    const seedName = typeof seedGroup.name === 'string' ? seedGroup.name : '';
    const foundIndex = out.findIndex((group) => {
      const candidate = asObject(group);
      return !!candidate && typeof candidate.name === 'string' && candidate.name === seedName;
    });

    if (foundIndex === -1) {
      out.push(deepClone(seedGroup));
      continue;
    }

    const targetGroup = asObject(out[foundIndex]);
    if (!targetGroup) continue;

    if (isBlank(targetGroup.icon) && typeof seedGroup.icon === 'string') {
      targetGroup.icon = seedGroup.icon;
    }

    const targetItems = asArray(targetGroup.items);
    const seedItems = asArray(seedGroup.items);
    targetGroup.items = mergeGroupItems(targetItems, seedItems);
  }

  return out;
};

const mergeElements = (targetElements, seedElements) => {
  const out = deepClone(targetElements);

  for (const rawSeedElement of seedElements) {
    const seedElement = asObject(rawSeedElement);
    if (!seedElement) continue;

    const seedType = typeof seedElement.type === 'string' ? seedElement.type : '';
    const targetIndex = out.findIndex((rawTargetElement) => {
      const targetElement = asObject(rawTargetElement);
      return !!targetElement && typeof targetElement.type === 'string' && targetElement.type === seedType;
    });

    if (targetIndex === -1) {
      out.push(deepClone(seedElement));
      continue;
    }

    const targetElement = asObject(out[targetIndex]);
    if (!targetElement) continue;

    if (isBlank(targetElement.icon) && typeof seedElement.icon === 'string') {
      targetElement.icon = seedElement.icon;
    }

    if (isBlank(targetElement.gridLayout) && typeof seedElement.gridLayout === 'string') {
      targetElement.gridLayout = seedElement.gridLayout;
    }

    const targetGroups = asArray(targetElement.groups);
    const seedGroups = asArray(seedElement.groups);
    if (seedGroups.length > 0) {
      targetElement.groups = mergeGroups(targetGroups, seedGroups);
    }

    const targetItems = asArray(targetElement.items);
    const seedItems = asArray(seedElement.items);
    if (seedItems.length > 0) {
      const isStringList = seedItems.every((item) => typeof item === 'string');
      if (isStringList) {
        targetElement.items = mergeStringArray(
          targetItems.filter((item) => typeof item === 'string'),
          seedItems,
        );
      } else {
        targetElement.items = mergeObjectArrayByJson(targetItems, seedItems);
      }
    }
  }

  return out;
};

const normalizeVerifyElements = (seedElements) => {
  const elements = deepClone(seedElements);
  if (!Array.isArray(elements) || elements.length === 0) {
    return elements;
  }

  const first = asObject(elements[0]);
  if (!first || first.type !== 'icon-list' || !Array.isArray(first.items)) {
    return elements;
  }

  const groups = first.items
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item, index) => {
      const parts = item
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const name = parts[0] || `Certification ${index + 1}`;
      const childValues = parts.length > 1 ? parts.slice(1) : [item.trim()];

      return {
        name,
        icon: 'pi pi-shield',
        items: childValues.map((value) => ({
          value,
          icon: 'pi pi-check-circle',
        })),
      };
    });

  return [
    {
      type: 'grid-tree',
      groups,
      gridLayout: 'single',
    },
  ];
};

const mergeCard = (targetCard, seedCard) => {
  const out = deepClone(targetCard ?? {});
  const replaceElementsCardIds = new Set(['education', 'experience', 'stack', 'projects', 'verify']);
  const normalizedSeedElements =
    seedCard.id === 'verify' && Array.isArray(seedCard.elements)
      ? normalizeVerifyElements(seedCard.elements)
      : seedCard.elements;

  const scalarKeys = ['title', 'subtitle', 'name', 'headline', 'text'];
  for (const key of scalarKeys) {
    if (!(key in seedCard)) continue;
    const seedValue = seedCard[key];
    if (seedValue === undefined) continue;
    if (!(key in out)) {
      out[key] = seedValue;
      continue;
    }

    if (isBlank(out[key]) && !isBlank(seedValue)) {
      out[key] = seedValue;
    }
  }

  if (replaceElementsCardIds.has(seedCard.id) && Array.isArray(normalizedSeedElements)) {
    out.elements = deepClone(normalizedSeedElements);
  } else if (!Array.isArray(out.elements) && Array.isArray(normalizedSeedElements)) {
    out.elements = deepClone(normalizedSeedElements);
  } else if (Array.isArray(out.elements) && Array.isArray(normalizedSeedElements)) {
    out.elements = mergeElements(out.elements, normalizedSeedElements);
  }

  out.id = seedCard.id;
  return out;
};

const mergePayloadByLocale = (remotePayload, seedLocalePayload) => {
  const out = deepClone(remotePayload);

  if (!asObject(out.card_content)) {
    out.card_content = {};
  }

  const outCardContent = out.card_content;
  const remoteCards = asArray(outCardContent.cards);
  const seedCards = asArray(seedLocalePayload?.card_content?.cards);

  const remoteMap = new Map();
  for (const card of remoteCards) {
    if (!asObject(card) || typeof card.id !== 'string') continue;
    remoteMap.set(card.id, card);
  }

  for (const seedCard of seedCards) {
    if (!asObject(seedCard) || typeof seedCard.id !== 'string') continue;
    const existing = remoteMap.get(seedCard.id);
    const merged = mergeCard(existing, seedCard);
    remoteMap.set(seedCard.id, merged);
  }

  outCardContent.cards = Array.from(remoteMap.values());
  return out;
};

const escapeSql = (value) => value.replace(/'/g, "''");
const statements = [];

for (const row of rows) {
  const lang = row.lang_code;
  const seedLocale = seed[lang];
  if (!seedLocale) {
    continue;
  }

  const remotePayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  const mergedPayload = mergePayloadByLocale(remotePayload, seedLocale);

  const payloadSql = escapeSql(JSON.stringify(mergedPayload));
  statements.push(
    `UPDATE resume_i18n_content SET payload = '${payloadSql}', updated_at = datetime('now') WHERE lang_code = '${escapeSql(String(lang))}';`,
  );
}

if (statements.length === 0) {
  throw new Error('No locale rows matched seed file for backfill');
}

fs.writeFileSync('.tmp/d1-backfill-from-seed.sql', `${statements.join('\n')}\n`);
console.log(`Prepared ${statements.length} UPDATE statements -> .tmp/d1-backfill-from-seed.sql`);
NODE

echo "[1/2] Apply seed merge backfill to remote D1"
npx wrangler d1 execute resume-api-db --remote --file "${repair_file}" --yes

echo "[2/2] Run card content audit"
bash ./scripts/d1-audit-card-content.sh
