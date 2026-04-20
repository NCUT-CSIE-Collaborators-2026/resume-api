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
- `[[d1_databases]]`：D1 綁定（`DB` -> `resume-api-db`）
- `[vars]`：非機密環境變數（例如 `CORS_ORIGINS`）

若未來更換 D1，請同步更新 `database_id`。

## D1 資料來源

**D1 是唯一的數據源**。所有履歷數據都存在遠端 D1 資料庫，代碼庫只包含 schema。

- `db/schema.sql`：D1 表結構（初始化用）
- 業務數據完全由 D1 管理

## D1 同步流程

### 建立 D1（只需一次）

```bash
npx wrangler d1 create resume-api-db
```

### 初始化 D1（首次創建時）

```bash
npx wrangler d1 execute resume-api-db --remote --file=db/schema.sql --yes
npx wrangler d1 execute resume-api-db --remote --file=db/seed.sql --yes
```

### 同步到本地 D1

```bash
npx wrangler d1 execute resume-api-db --local --file=db/schema.sql
```

數據會自動從遠端 D1 同步到本地（開發時 `wrangler dev` 會使用本地副本）。

### 驗證資料

```bash
npx wrangler d1 execute resume-api-db --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content ORDER BY lang_code;" --yes
npx wrangler d1 execute resume-api-db --local --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content ORDER BY lang_code;"
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
