import 'dotenv/config';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { createContentRepository } from './content-repository.js';

const app = new Hono();
const port = Number(process.env.PORT ?? 8787);
const apiBasePath = process.env.API_BASE_PATH ?? '/api/resume';
const dataFile = resolve(
  process.cwd(),
  process.env.DATA_FILE_PATH ?? '../resume-db/source/content.i18n.json',
);
const dbPath = process.env.DB_PATH ?? '../resume-db/data/resume.db';
const autoMigrateJsonToDb =
  (process.env.AUTO_MIGRATE_JSON_TO_DB ?? 'true').toLowerCase() === 'true';
const corsOrigins = (process.env.CORS_ORIGINS ??
  'http://localhost:4200,https://haolun-wang.pages.dev')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const corsOriginOption =
  corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins;

const repository = createContentRepository({
  dbPath,
  jsonDataFilePath: dataFile,
  autoMigrateJsonToDb,
});

await repository.bootstrap();

app.use(
  `${apiBasePath}/*`,
  cors({
    origin: corsOriginOption,
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

app.get(`${apiBasePath}/health`, (c) => c.json({ ok: true }));

app.get(`${apiBasePath}/content.i18n`, async (c) => {
  try {
    const content = repository.getAll();
    return c.json(content);
  } catch (error) {
    return c.json(
      {
        message: 'Failed to read i18n content from SQLite',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

app.post(`${apiBasePath}/content.i18n/sync`, async (c) => {
  try {
    await repository.syncFromJson();
    return c.json({ ok: true, message: 'Synced JSON to SQLite' });
  } catch (error) {
    return c.json(
      {
        message: 'Failed to sync JSON to SQLite',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Hono API listening on http://localhost:${info.port}`);
    console.log(`API base path: ${apiBasePath}`);
    console.log(`CORS origins: ${corsOrigins.join(', ')}`);
    console.log(`DB path: ${dbPath}`);
    console.log(`AUTO_MIGRATE_JSON_TO_DB: ${autoMigrateJsonToDb}`);
  },
);
