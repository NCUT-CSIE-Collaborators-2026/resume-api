# Resume API (Hono)

Cloudflare Workers + D1 backend API for resume-skeleton.

## Setup

```bash
npm install
npm run dev
```

Local dev runs with Wrangler.

## Endpoints

- `GET /api/resume/health`
- `GET /api/resume/content.i18n`

## Workers Config

Main config file: `wrangler.toml`

- `name`: Worker name
- `main`: `src/index.ts`
- `[[d1_databases]]`: D1 binding (`DB`)
- `[vars]`: non-secret runtime vars (e.g. `CORS_ORIGINS`)

Current D1 binding is configured in `wrangler.toml`:

- `database_id = "41be8a01-6d89-4bb8-8dea-84bc002a1175"`

If you create a new D1 database later, update this value accordingly.

## D1 Data Source

DB assets are maintained in sibling project `../resume-db`:

- `../resume-db/db/schema.sql`
- `../resume-db/db/seed.sql`
- `../resume-db/source/content.i18n.json`

Regenerate seed SQL from source JSON:

```bash
npm run db:seed:generate
```

## Create and Seed D1

```bash
npx wrangler d1 create resume-api-db
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/schema.sql
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/seed.sql
```

Verify:

```bash
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content;"
```

## Deploy (CLI)

```bash
npm run deploy
```

## Deploy (Cloudflare Git UI)

For the screen you shared, use:

- Project name: `resume-api`
- Build command: leave empty (or `npm run build`)
- Deploy command: `npx wrangler deploy`
- Root directory: `resume-api`

Then in Cloudflare project settings:

- Add D1 binding `DB`
- Set `CORS_ORIGINS` variable if needed

## Type Check

```bash
npm run build
```
