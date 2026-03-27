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
- `DATA_FILE_PATH`: local JSON source path

## Endpoints

- `GET /api/resume/health`
- `GET /api/resume/content.i18n`

## Cloudflare D1 (Free Tier)

This project now includes D1-ready SQL assets:

- Schema: `db/schema.sql`
- Seed data: `db/seed.sql`
- Read query: `db/query-content.sql`

### 1) Regenerate seed from JSON source

```bash
npm run db:seed:generate
```

This converts `src/data/content.i18n.json` into SQL inserts for D1.

### 2) Create D1 database

```bash
npx wrangler d1 create resume-api-db
```

### 3) Apply schema and seed (remote)

```bash
npx wrangler d1 execute resume-api-db --remote --file=db/schema.sql
npx wrangler d1 execute resume-api-db --remote --file=db/seed.sql
```

### 4) Verify data in D1

```bash
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content;"
```

## Build

```bash
npm run build
```
