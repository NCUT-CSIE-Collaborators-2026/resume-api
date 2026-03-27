import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type LangCode = 'en' | 'zh_TW';

export interface ContentLocale {
  profile: {
    name: string;
    title: string;
    gender: string;
    age: string;
    status: string;
    mbti: string;
  };
  education: {
    school: string;
    department: string;
    degree: string;
    graduation_status: string;
  };
  experience: {
    intern_title: string;
    assistant_title: string;
    military_title: string;
  };
  tech_stack: {
    language: string[];
    frontend: string[];
    backend: string[];
    database: string[];
    devops: string[];
  };
  introductions: {
    pitch_30s: string;
    pitch_1min: string;
  };
  projects: {
    items: string[];
  };
}

export type ContentMap = Record<LangCode, ContentLocale>;

interface ContentRow {
  lang_code: string;
  payload: string;
}

export interface ContentRepository {
  bootstrap(): Promise<void>;
  getAll(): ContentMap;
  syncFromJson(): Promise<void>;
}

interface RepositoryOptions {
  dbPath: string;
  jsonDataFilePath: string;
  autoMigrateJsonToDb: boolean;
}

const ensureSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_i18n_content (
      lang_code TEXT PRIMARY KEY,
      payload TEXT NOT NULL CHECK (json_valid(payload)),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_resume_i18n_updated_at
      ON resume_i18n_content (updated_at);
  `);
};

const createSyncFromJson = (
  db: Database.Database,
  jsonDataFilePath: string,
): (() => Promise<void>) => {
  return async () => {
    const raw = await readFile(jsonDataFilePath, 'utf8');
    const content = JSON.parse(raw) as Partial<Record<LangCode, ContentLocale>>;

    if (!content.en || !content.zh_TW) {
      throw new Error('JSON source is missing required locales: en and zh_TW');
    }

    const upsert = db.prepare(`
      INSERT INTO resume_i18n_content (lang_code, payload, updated_at)
      VALUES (?, json(?), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(lang_code)
      DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `);

    const transaction = db.transaction((rows: Array<[LangCode, ContentLocale]>) => {
      for (const [langCode, payload] of rows) {
        upsert.run(langCode, JSON.stringify(payload));
      }
    });

    transaction([
      ['en', content.en],
      ['zh_TW', content.zh_TW],
    ]);
  };
};

export const createContentRepository = ({
  dbPath,
  jsonDataFilePath,
  autoMigrateJsonToDb,
}: RepositoryOptions): ContentRepository => {
  const absoluteDbPath = resolve(process.cwd(), dbPath);
  mkdirSync(dirname(absoluteDbPath), { recursive: true });

  const db = new Database(absoluteDbPath);
  ensureSchema(db);

  const syncFromJson = createSyncFromJson(db, jsonDataFilePath);

  return {
    async bootstrap() {
      const countRow = db
        .prepare('SELECT COUNT(*) AS total FROM resume_i18n_content')
        .get() as { total: number };

      if (countRow.total === 0 && autoMigrateJsonToDb) {
        await syncFromJson();
      }
    },

    getAll() {
      const rows = db
        .prepare(
          'SELECT lang_code, json(payload) AS payload FROM resume_i18n_content ORDER BY lang_code',
        )
        .all() as ContentRow[];

      const contentMap: Partial<ContentMap> = {};

      for (const row of rows) {
        if (row.lang_code === 'en' || row.lang_code === 'zh_TW') {
          contentMap[row.lang_code] = JSON.parse(row.payload) as ContentLocale;
        }
      }

      if (!contentMap.en || !contentMap.zh_TW) {
        throw new Error('DB is missing required locales: en and zh_TW');
      }

      return contentMap as ContentMap;
    },

    syncFromJson,
  };
};
