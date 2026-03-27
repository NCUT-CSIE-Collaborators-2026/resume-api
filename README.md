# Resume API (Hono)

`resume-skeleton` 使用的後端 API，採用 Cloudflare Workers + D1。

## 專案功能

- 根路由回傳服務資訊：`GET /`
- 提供履歷 API：`GET /api/resume/health`
- 提供 i18n 內容 API：`GET /api/resume/content.i18n`
- 提供 OpenAPI 文件：`GET /api/resume/openapi.json`
- 提供 Swagger UI：`GET /api/resume/docs`
- 後端資料來源為 D1 資料表 `resume_i18n_content`

## 安裝與本地啟動

```bash
npm install
npm run dev
```

如需讓 Docker 內的 Nginx 反向代理連到本地 Worker，請改用：

```bash
npx wrangler dev --local --ip 0.0.0.0 --port 8787
```

## 主要設定檔

主設定檔為 `wrangler.toml`：

- `name`：Worker 名稱
- `main`：入口檔（`src/index.ts`）
- `[[d1_databases]]`：D1 綁定（目前為 `DB`）
- `[vars]`：非機密環境變數（例如 `CORS_ORIGINS`）

目前 D1 綁定已設定：

- `database_name = "resume-api-db"`
- `database_id = "41be8a01-6d89-4bb8-8dea-84bc002a1175"`

若未來更換 D1，請同步更新 `database_id`。

## D1 資料來源

資料檔集中在兄弟專案 `../resume-db`：

- `../resume-db/db/schema.sql`
- `../resume-db/db/seed.sql`
- `../resume-db/source/content.i18n.json`

若 JSON 有更新，先重新產生 seed：

```bash
npm run db:seed:generate
```

注意：`seed.sql` 已調整為 D1 遠端可執行格式（不含 `BEGIN TRANSACTION` / `COMMIT`）。

## D1 建立與灌資料

### 建立 D1（只需一次）

```bash
npx wrangler d1 create resume-api-db
```

### 灌遠端 D1（正式環境）

```bash
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/schema.sql --yes
npx wrangler d1 execute resume-api-db --remote --file=../resume-db/db/seed.sql --yes
```

### 驗證遠端資料

```bash
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content ORDER BY lang_code;" --yes
```

### 本地 D1（開發）

```bash
npx wrangler d1 execute resume-api-db --local --file=../resume-db/db/schema.sql
npx wrangler d1 execute resume-api-db --local --file=../resume-db/db/seed.sql
```

## 部署

### CLI 部署

```bash
npm run deploy
```

### Cloudflare Git 直連部署

若你是從 Cloudflare Dashboard 直接連 GitHub 建專案，部署由 Cloudflare 平台代跑，不需要把 Token 放進此 repo。

建議設定：

- Project name：`resume-api`
- Root directory：`resume-api`
- Build command：可留空（或 `npm run build`）
- Deploy command：`npx wrangler deploy`

並在 Cloudflare 專案設定補上：

- D1 binding：`DB` -> `resume-api-db`
- 變數：`CORS_ORIGINS`（依你的前端網域調整）

## 型別檢查

```bash
npm run build
```

## 常見問題

### 1) `Authentication error [code: 10000]`

代表 Wrangler 權限不足或 Token 設定錯誤。若使用 CLI 遠端操作，請確認：

- `CLOUDFLARE_API_TOKEN` 權限至少含：
	- Account / Workers Scripts / Edit
	- Account / D1 / Edit
	- Account / Account Settings / Read
	- User / Memberships / Read
- `CLOUDFLARE_ACCOUNT_ID` 是否為正確帳號

### 2) 本地 API 經過 Nginx 回 502

請確認 Worker 不是只綁在 `127.0.0.1`，要用：

```bash
npx wrangler dev --local --ip 0.0.0.0 --port 8787
```
