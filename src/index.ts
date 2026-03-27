import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { Hono } from 'hono';

type LangCode = 'en' | 'zh_TW';

interface ContentLocale {
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

type ContentMap = Record<LangCode, ContentLocale>;

const app = new Hono();
const port = Number(process.env.PORT ?? 8787);
const apiBasePath = process.env.API_BASE_PATH ?? '/api/resume';
const dataFile = resolve(
  process.cwd(),
  process.env.DATA_FILE_PATH ?? 'src/data/content.i18n.json',
);
const corsOrigins = (process.env.CORS_ORIGINS ??
  'http://localhost:4200,https://haolun-wang.pages.dev')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const corsOriginOption =
  corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins;

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
    const raw = await readFile(dataFile, 'utf8');
    const content = JSON.parse(raw) as ContentMap;
    return c.json(content);
  } catch (error) {
    return c.json(
      {
        message: 'Failed to read i18n content',
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
  },
);
