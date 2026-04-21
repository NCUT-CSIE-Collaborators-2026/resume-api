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
repair_file="${backup_dir}/resume-api-db-repair.sql"

if [[ ! -f "${backup_file}" ]]; then
  echo "Missing backup file: ${backup_file}"
  echo "Run d1 sync/export first so prune has an immutable source payload"
  exit 1
fi

mkdir -p "${backup_dir}"

node --input-type=module <<'NODE'
import fs from 'node:fs';

const backupPath = '.tmp/resume-api-db-remote.sql';
const repairPath = '.tmp/resume-api-db-repair.sql';
const backupSql = fs.readFileSync(backupPath, 'utf8');

const backfillByLang = {
  en: {
    profileName: 'Haolun Wang',
    profileHeadline: 'Software Engineer / IT Intern',
    intro30:
      "Hi, I'm Haolun, focusing on TypeScript full-stack development with Angular and NestJS. Currently studying CS at NCUT and working as an IT Intern.",
    intro60:
      'Hi, I am Haolun Wang, a Computer Science student at NCUT and an IT Intern. With two years of TypeScript experience, I specialize in Angular and NestJS, optimizing deployment with Docker and maintaining high-quality solutions.',
    projectsTitle: 'Projects',
    verifyTitle: 'Certification',
  },
  zh_TW: {
    profileName: '王顥倫',
    profileHeadline: '軟體工程師 / IT 實習生',
    intro30:
      '你好，我是顥倫，專注於 TypeScript 全端開發，主要使用 Angular 與 NestJS。目前在勤益資工就讀，同時擔任 IT 實習生，持續參與 Web 系統開發。',
    intro60:
      '你好，我是王顥倫，目前就讀於勤益科技大學資訊工程系，並擔任 IT 實習生。擁有 兩年 TypeScript 開發經驗，深耕於 Angular（獨立元件架構） 與 NestJS 框架的完整開發流程。我擅長利用 Docker 優化部署與開發環境，並具備獨立處理功能開發、系統除錯與維護的能力，致力於打造高品質、可落地的技術解決方案。',
    projectsTitle: '專案',
    verifyTitle: '專業證照',
  },
};

const parseRow = (lang) => {
  const pattern = new RegExp(
    String.raw`INSERT INTO "resume_i18n_content" \("lang_code","payload","updated_at"\) VALUES\('${lang}','([\s\S]*?)','([^']+)'\);`,
  );
  const match = backupSql.match(pattern);
  if (!match) {
    throw new Error(`Unable to locate payload for ${lang} in ${backupPath}`);
  }

  return {
    updatedAt: match[2],
    payload: JSON.parse(match[1].replace(/''/g, "'")),
  };
};

const asString = (value) => (typeof value === 'string' ? value.trim() : '');
const asArray = (value) => (Array.isArray(value) ? value : []);
const isNonEmptyArray = (value) => Array.isArray(value) && value.length > 0;
const textElement = (text) => [{ type: 'text', text }];

const badgeItems = (profile) =>
  [profile.gender, profile.age, profile.mbti, profile.email]
    .map((value) => asString(value))
    .filter((value) => value.length > 0);

const elementGroups = (card) => {
  if (!card || !Array.isArray(card.elements) || card.elements.length === 0) {
    return [];
  }

  const first = card.elements[0];
  if (!first || !Array.isArray(first.groups)) {
    return [];
  }

  return first.groups;
};

const elementItems = (card) => {
  if (!card || !Array.isArray(card.elements) || card.elements.length === 0) {
    return [];
  }

  const first = card.elements[0];
  if (!first || !Array.isArray(first.items)) {
    return [];
  }

  return first.items;
};

const buildCardsMap = (payload) => {
  const cards = asArray(payload?.card_content?.cards);
  return Object.fromEntries(
    cards
      .filter((card) => card && typeof card === 'object' && typeof card.id === 'string')
      .map((card) => [card.id, card]),
  );
};

const legacyEntry = (payload, id) => {
  const cardContent = payload?.card_content;
  if (!cardContent || typeof cardContent !== 'object' || Array.isArray(cardContent)) {
    return null;
  }

  const value = cardContent[id];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value;
};

const pickElements = (...candidates) => {
  for (const candidate of candidates) {
    if (isNonEmptyArray(candidate)) {
      return candidate;
    }
  }

  return [];
};

const normalizeGroups = (groups) =>
  asArray(groups)
    .filter((group) => group && typeof group === 'object')
    .map((group) => ({
      name: asString(group.name),
      icon: asString(group.icon) || 'pi pi-folder-open',
      items: asArray(group.items)
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          value: asString(item.value),
          icon: asString(item.icon) || 'pi pi-check-circle',
        }))
        .filter((item) => item.value.length > 0),
    }))
    .filter((group) => group.name.length > 0 || group.items.length > 0);

const parseTechNode = (rawValue) => {
  const value = asString(rawValue);
  if (!value) {
    return null;
  }

  const parenthesisMatch = value.match(/^(.+?)\s*\((.+)\)$/);
  if (parenthesisMatch) {
    return {
      value: parenthesisMatch[1].trim(),
      icon: 'pi pi-code',
      children: [{ value: parenthesisMatch[2].trim(), icon: 'pi pi-sitemap' }],
    };
  }

  const versionMatch = value.match(/^(.+?)\s+([0-9][0-9A-Za-z+._-]*)$/);
  if (versionMatch) {
    return {
      value: versionMatch[1].trim(),
      icon: 'pi pi-code',
      children: [{ value: versionMatch[2].trim(), icon: 'pi pi-tag' }],
    };
  }

  return {
    value,
    icon: 'pi pi-code',
    children: [{ value: 'core', icon: 'pi pi-sitemap' }],
  };
};

const toStackGroupsFromGridTech = (elements) => {
  const list = asArray(elements);
  const first = list[0];
  if (!first || first.type !== 'grid-tech' || !Array.isArray(first.items)) {
    return [];
  }

  return first.items
    .filter((category) => category && typeof category === 'object')
    .map((category) => {
      const label = asString(category.label);
      const items = asArray(category.value)
        .map((value) => parseTechNode(value))
        .filter((item) => item !== null);

      return {
        name: label,
        icon: 'pi pi-cog',
        items,
      };
    })
    .filter((group) => group.name.length > 0);
};

const normalizeStackElements = (elements, fallbackGroups) => {
  const list = asArray(elements);
  const first = list[0];
  if (first && first.type === 'grid-tree' && Array.isArray(first.groups)) {
    return [{ type: 'grid-tree', groups: first.groups, gridLayout: first.gridLayout || 'compact' }];
  }

  const convertedGroups = toStackGroupsFromGridTech(list);
  if (convertedGroups.length > 0) {
    return [{ type: 'grid-tree', groups: convertedGroups, gridLayout: 'compact' }];
  }

  return fallbackGroups.length > 0
    ? [{ type: 'grid-tree', groups: fallbackGroups, gridLayout: 'compact' }]
    : [];
};

const buildFinalPayload = (payload, lang) => {
  const seed = backfillByLang[lang];
  if (!seed) {
    throw new Error(`No backfill seed for lang ${lang}`);
  }

  const profile = payload.profile ?? {};
  const education = payload.education ?? {};
  const experience = payload.experience ?? {};
  const techStack = payload.tech_stack ?? {};
  const introductions = payload.introductions ?? {};
  const projects = payload.projects ?? {};
  const verify = payload.verify ?? {};

  const cards = buildCardsMap(payload);

  const profileCard = cards.profile ?? legacyEntry(payload, 'profile') ?? {};
  const intro30Card = cards.intro_30 ?? legacyEntry(payload, 'intro_30') ?? {};
  const intro60Card = cards.intro_60 ?? legacyEntry(payload, 'intro_60') ?? {};
  const educationCard = cards.education ?? legacyEntry(payload, 'education') ?? {};
  const experienceCard = cards.experience ?? legacyEntry(payload, 'experience') ?? {};
  const stackCard = cards.stack ?? legacyEntry(payload, 'stack') ?? {};
  const projectsCard = cards.projects ?? legacyEntry(payload, 'projects') ?? {};
  const verifyCard = cards.verify ?? legacyEntry(payload, 'verify') ?? {};

  const intro30Text = asString(intro30Card.text) || asString(introductions.pitch_30s) || seed.intro30;
  const intro60Text = asString(intro60Card.text) || asString(introductions.pitch_1min) || seed.intro60;

  const educationFallbackGroups = normalizeGroups([
    {
      name: asString(education.school),
      icon: 'pi pi-building-columns',
      items: [
        { value: asString(education.department), icon: 'pi pi-book' },
        { value: asString(education.degree), icon: 'pi pi-graduation-cap' },
        { value: asString(education.graduation_status), icon: 'pi pi-calendar' },
      ],
    },
  ]);

  const experienceFallbackGroups = normalizeGroups([
    {
      name: 'Experience 1',
      icon: 'pi pi-briefcase',
      items: [{ value: asString(experience.intern_title), icon: 'pi pi-briefcase' }],
    },
    {
      name: 'Experience 2',
      icon: 'pi pi-briefcase',
      items: [{ value: asString(experience.assistant_title), icon: 'pi pi-briefcase' }],
    },
    {
      name: 'Experience 3',
      icon: 'pi pi-briefcase',
      items: [{ value: asString(experience.military_title), icon: 'pi pi-briefcase' }],
    },
  ]);

  const stackFallbackGroups = [
    { name: lang === 'zh_TW' ? '語言' : 'Language', icon: 'pi pi-code', items: asArray(techStack.language).map((value) => parseTechNode(value)).filter((item) => item !== null) },
    { name: lang === 'zh_TW' ? '前端' : 'Frontend', icon: 'pi pi-desktop', items: asArray(techStack.frontend).map((value) => parseTechNode(value)).filter((item) => item !== null) },
    { name: lang === 'zh_TW' ? '後端' : 'Backend', icon: 'pi pi-server', items: asArray(techStack.backend).map((value) => parseTechNode(value)).filter((item) => item !== null) },
    { name: lang === 'zh_TW' ? '資料庫' : 'Database', icon: 'pi pi-database', items: asArray(techStack.database).map((value) => parseTechNode(value)).filter((item) => item !== null) },
    { name: 'DevOps', icon: 'pi pi-cog', items: asArray(techStack.devops).map((value) => parseTechNode(value)).filter((item) => item !== null) },
  ].filter((group) => group.items.length > 0);

  const projectsGroups = normalizeGroups(
    elementGroups(projectsCard).length > 0
      ? elementGroups(projectsCard)
      : asArray(projects.groups),
  );

  const verifyListItems = (() => {
    const existingItems = elementItems(verifyCard).filter((item) => typeof item === 'string' && item.trim().length > 0);
    if (existingItems.length > 0) {
      return existingItems;
    }

    const verifyItems = asArray(verify.items)
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return verifyItems;
  })();

  const verifyGroups = verifyListItems.map((value, index) => {
    const parts = value
      .split('|')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const name = parts[0] || `Certification ${index + 1}`;
    const childValues = parts.length > 1 ? parts.slice(1) : [value];

    return {
      name,
      icon: 'pi pi-shield',
      items: childValues.map((itemValue) => ({
        value: itemValue,
        icon: 'pi pi-check-circle',
      })),
    };
  });

  return {
    card_content: {
      cards: [
        {
          id: 'profile',
          name: asString(profileCard.name) || asString(profile.name) || seed.profileName,
          headline: asString(profileCard.headline) || asString(profile.title) || seed.profileHeadline,
          subtitle: asString(profileCard.subtitle) || asString(profile.status),
          elements: pickElements(profileCard.elements, [{ type: 'badges', items: badgeItems(profile) }]),
        },
        {
          id: 'intro_30',
          text: intro30Text,
          elements: pickElements(intro30Card.elements, textElement(intro30Text)),
        },
        {
          id: 'intro_60',
          text: intro60Text,
          elements: pickElements(intro60Card.elements, textElement(intro60Text)),
        },
        {
          id: 'education',
          elements: pickElements(
            educationCard.elements,
            educationFallbackGroups.length > 0
              ? [{ type: 'grid-tree', groups: educationFallbackGroups, gridLayout: 'compact' }]
              : [],
          ),
        },
        {
          id: 'experience',
          elements: pickElements(
            experienceCard.elements,
            experienceFallbackGroups.length > 0
              ? [{ type: 'grid-tree', groups: experienceFallbackGroups, gridLayout: 'compact' }]
              : [],
          ),
        },
        {
          id: 'stack',
          elements: normalizeStackElements(stackCard.elements, stackFallbackGroups),
        },
        {
          id: 'projects',
          title: asString(projectsCard.title) || asString(projects.title) || seed.projectsTitle,
          elements: pickElements(
            projectsCard.elements,
            projectsGroups.length > 0
              ? [{ type: 'grid-tree', groups: projectsGroups, gridLayout: 'single' }]
              : [],
          ),
        },
        {
          id: 'verify',
          title: asString(verifyCard.title) || asString(verify.title) || seed.verifyTitle,
          elements: pickElements(
            verifyCard.elements,
            [{ type: 'grid-tree', groups: verifyGroups, gridLayout: 'single' }],
          ),
        },
      ],
    },
  };
};

const escapeSql = (value) => value.replace(/'/g, "''");

const statements = ['en', 'zh_TW'].map((lang) => {
  const { updatedAt, payload } = parseRow(lang);
  const nextPayload = buildFinalPayload(payload, lang);
  return `UPDATE resume_i18n_content SET payload = '${escapeSql(JSON.stringify(nextPayload))}', updated_at = '${updatedAt}' WHERE lang_code = '${lang}';`;
});

fs.writeFileSync(repairPath, `${statements.join('\n')}\n`);
NODE

echo "[1/3] Rebuild payload into cards-only schema"
npx wrangler d1 execute resume-api-db --remote --file "${repair_file}" --yes

echo "[2/3] Run card-content audit"
bash ./scripts/d1-audit-card-content.sh

echo "[3/3] Prune completed"
