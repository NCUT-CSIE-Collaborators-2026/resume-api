# Resume API (Hono)

Standalone backend API for resume-skeleton.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Server default: `http://localhost:8787`

## Environment Variables

Set values in `.env` (or copy from `.env.example`):

- `PORT`: API server port (default `8787`)
- `API_BASE_PATH`: route prefix (default `/api/resume`)
- `CORS_ORIGINS`: comma-separated allowed origins
- `DATA_FILE_PATH`: external JSON source path (default `../resume-db/source/content.i18n.json`)
- `DB_PATH`: SQLite path (default `../resume-db/data/resume.db`)
- `AUTO_MIGRATE_JSON_TO_DB`: auto-import JSON when DB is empty

## Endpoints

- `GET /api/resume/health`
- `GET /api/resume/content.i18n`
- `POST /api/resume/content.i18n/sync`

## Unified Local DB Mode

Runtime source of truth is now local SQLite (same SQLite family as Cloudflare D1).

- DB file: `../resume-db/data/resume.db`
- Source JSON: `../resume-db/source/content.i18n.json`
- On startup: if DB table is empty and `AUTO_MIGRATE_JSON_TO_DB=true`, JSON seed will auto-import.

Manual sync from JSON to SQLite:

```bash
npm run db:sync:json
```

## Cloudflare D1 (Free Tier)

This project now includes D1-ready SQL assets:

- Schema: `../resume-db/db/schema.sql`
- Seed data: `../resume-db/db/seed.sql`
- Read query: `../resume-db/db/query-content.sql`

### 1) Regenerate seed from JSON source

```bash
npm run db:seed:generate
```

This converts `../resume-db/source/content.i18n.json` into SQL inserts for D1.

### 2) Create D1 database

```bash
npx wrangler d1 create resume-api-db
```

### 3) Apply schema and seed (remote)

```bash
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/schema.sql
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/seed.sql
```

### 4) Verify data in D1

```bash
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content;"
```

## Build

```bash
npm run build
```
