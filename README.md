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
cp .dev.vars.local.example .dev.vars.local
cp .dev.vars.secret.example .dev.vars.secret
# 編輯 .dev.vars.local / .dev.vars.secret
npm run dev
```

`npm run dev` / `npm run dev:local` 會在啟動時自動生成 `.dev.vars`，並在程序結束後自動刪除。

如需讓 Docker 內的 Nginx 反向代理連到本地 Worker，請改用：

```bash
npm run dev:local
```

## 主要設定檔

主設定檔為 `wrangler.toml`：

- `name`：Worker 名稱
- `main`：入口檔（`src/index.ts`）
- `[[d1_databases]]`：D1 綁定（`DB` -> 由 `database_id` 指向實際 D1）
- `[vars]`：非機密環境變數（例如 `CORS_ORIGINS`）

若未來更換 D1，請同步更新 `database_id`。

## 專案目錄（可執行基準）

以下是目前這個專案可正常執行時，建議看到的目錄樣貌：

```text
resume-api/
├─ package.json                     # 必備：npm scripts（dev/deploy/d1:*）
├─ package-lock.json                # 必備：鎖定套件版本
├─ tsconfig.json                    # 必備：TypeScript 設定
├─ wrangler.toml                    # 必備：Workers/D1 綁定設定
├─ README.md                        # 必備：操作說明
├─ .gitignore                       # 必備：忽略機密與暫存
├─ .env.wrangler.local.example      # 建議版控：機密範本
├─ .env.wrangler.local              # 本機機密：不要上傳 Git
├─ .dev.vars.local.example          # 建議版控：本機非機密變數範本
├─ .dev.vars.secret.example         # 建議版控：本機機密變數範本
├─ .dev.vars.local                  # 本機檔案：不要上傳 Git
├─ .dev.vars.secret                 # 本機機密：不要上傳 Git
├─ .dev.vars                        # 執行產物：由 compose 腳本自動生成
├─ src/
│  └─ index.ts                      # 必備：API 入口與路由
├─ scripts/
│  ├─ dev-local.sh                  # 建議：本地開發啟動
│  ├─ dev-vars-compose.sh           # 建議：合併 .dev.vars.local + .dev.vars.secret
│  ├─ d1-auth-check.sh              # 建議：憑證檢查
│  └─ d1-sync-from-remote.sh        # 建議：遠端同步到本地
├─ node_modules/                    # 執行產物：npm install 後產生
├─ .wrangler/                       # 執行產物：wrangler 本地狀態
├─ .tmp/                            # 執行產物：D1 匯出/匯入中間檔
└─ wrangler.log                     # 執行產物：wrangler 日誌
```

說明：

- 可提交到 Git：`src/`、`scripts/`、`package.json`、`wrangler.toml`、`.env.wrangler.local.example`、`.dev.vars.local.example`、`.dev.vars.secret.example`
- 不可提交到 Git：`.env.wrangler.local`、`.dev.vars.local`、`.dev.vars.secret`、`.dev.vars`、`.wrangler/`、`.tmp/`、`node_modules/`、`wrangler.log`
- 若你是剛 `git pull` 的新環境，沒有 `.wrangler/`、`.tmp/`、`node_modules/` 都是正常的

## D1 資料來源

**D1 是唯一的數據源**。API 讀寫都走 `resume_i18n_content`，不讀 repo 內 JSON。

- 不提交任何 sqlite / db 資料檔到 Git
- 本地 D1 只用於開發測試，遠端 D1 才是正式資料來源

## D1 同步流程

### 先看這段（避免再混淆）

- `--remote`：操作 Cloudflare 遠端 D1
- `--local`：操作本機 `.wrangler/state/v3/d1` 的 sqlite 副本
- 建表成功不等於資料同步成功，資料仍可能不同步

### Wrangler 登入與憑證設定（遠端 D1 必做）

在 Linux 伺服器（無瀏覽器）建議使用 API Token，不建議依賴 `wrangler login` 的 OAuth 跳轉。

1. 建立本地機密檔案（此檔案應被 git ignore）：

```bash
cp .env.wrangler.local.example .env.wrangler.local
```

2. 編輯 `.env.wrangler.local`，填入真實值（不可用 `your_token_here` / `your_account_id_here`）：

```bash
export CLOUDFLARE_API_TOKEN="<your_real_api_token>"
export CLOUDFLARE_ACCOUNT_ID="<your_real_account_id>"
```

3. 載入環境變數：

```bash
source .env.wrangler.local
```

4. 驗證憑證可用：

```bash
npm run d1:auth:check
```

5. 通過後再執行遠端 D1 指令。

### 常用腳本（建議直接用）

```bash
npm run d1:init:remote       # 建立遠端表結構
npm run d1:init:local        # 建立本地表結構
npm run d1:status:remote     # 看遠端資料版本（lang / updated_at / payload_size）
npm run d1:status:local      # 看本地資料版本
npm run d1:sync:from-remote  # 先清空本地表，清理 sqlite_sequence 語句後，再以遠端資料覆蓋本地副本
npm run d1:prune:card-content # 把舊 top-level 欄位清掉，改成 card_content.cards 陣列
npm run d1:audit:card-content # 稽核 card_content.cards 重要欄位是否完整
npm run d1:backfill:seed     # 用 .tmp/backfill-seed.json 做「只補缺、不覆蓋」回填
```

### 卡片資料遷移建議流程

```bash
npm run d1:sync:from-remote
# 確認 .tmp/resume-api-db-remote.sql 已存在且是最新備份
npm run d1:prune:card-content
npm run d1:audit:card-content
# 若要把你提供的 seed 值補回遠端
npm run d1:backfill:seed
```

### 最短流程（新機器 / 剛 pull）

```bash
cp .env.wrangler.local.example .env.wrangler.local
# 編輯 .env.wrangler.local，填入真實 Token 與 Account ID
source .env.wrangler.local

npm run d1:auth:check
npm run d1:init:remote
npm run d1:init:local
npm run d1:sync:from-remote
```

完成後，API 在 local 模式就會讀到和遠端一致的資料。

### 建立 D1（只需一次）

```bash
npx wrangler d1 create <your-d1-name>
```

說明：此專案目前綁定的 `database_id = 41be8a01-6d89-4bb8-8dea-84bc002a1175`，在你的 Cloudflare 帳號中對應的資料庫名稱是 `resume-skeleton`。

### 驗證資料

```bash
npm run d1:status:remote
npm run d1:status:local
```

## 部署

### 部署前必做（手動參數清單）

以下參數在部署環境一定要存在，否則會出現登入/編輯 API 失敗。

#### D1 Binding（必填）

- `DB` -> 對應 `database_id = 41be8a01-6d89-4bb8-8dea-84bc002a1175` 的 D1

#### Variables（可公開，建議手動確認）

- `API_BASE_PATH`（例：`/api/resume/v0`）
- `CORS_ORIGINS`（例：前端網域白名單）
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_OAUTH_SUCCESS_REDIRECT`
- `GOOGLE_OAUTH_FAILURE_REDIRECT`
- `GOOGLE_OAUTH_SCOPES`（預設可用 `openid email profile`）
- `GOOGLE_OAUTH_DEBUG_RESPONSE`（預設 `false`）

#### Secrets（機密，必須手動新增）

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JWT_SECRET`

說明：本地開發用的 `.dev.vars.local` / `.dev.vars.secret` 不會自動帶到雲端部署，部署時要在 Cloudflare 專案設定中手動補齊。

### CLI 部署（wrangler deploy）

```bash
npm run deploy
```

若尚未設定 secrets，可用以下指令逐一新增：

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
```

### Cloudflare Git 直連部署

若你是從 Cloudflare Dashboard 直接連 GitHub 建專案，部署由 Cloudflare 平台代跑，不需要把 Token 放進此 repo。

建議設定：

- Project name：`resume-api`
- Root directory：`resume-api`
- Build command：可留空（或 `npm run build`）
- Deploy command：`npx wrangler deploy`

並在 Cloudflare 專案設定補上：

- D1 binding：`DB` -> 對應 `database_id = 41be8a01-6d89-4bb8-8dea-84bc002a1175` 的 D1
- Variables：`API_BASE_PATH`、`CORS_ORIGINS`、`GOOGLE_REDIRECT_URI`、`GOOGLE_OAUTH_SUCCESS_REDIRECT`、`GOOGLE_OAUTH_FAILURE_REDIRECT`、`GOOGLE_OAUTH_SCOPES`、`GOOGLE_OAUTH_DEBUG_RESPONSE`
- Secrets：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`JWT_SECRET`

建議部署後先做健康檢查：

```bash
curl -i https://<your-worker-domain>/api/resume/v0/health
```

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

### 2) `Could not route ... /accounts/your_account_id_here/... [code: 7003]`

代表你目前送出的 `CLOUDFLARE_ACCOUNT_ID` 不是真實帳號（常見是還在用占位符）。請檢查：

```bash
source .env.wrangler.local
echo "$CLOUDFLARE_ACCOUNT_ID"
```

若輸出是 `your_account_id_here`，請立即改成真實 Account ID。

### 3) `Invalid format for Authorization header [code: 6111]`

代表 `CLOUDFLARE_API_TOKEN` 格式不正確（常見是占位符或貼錯字串）。請重新產生 Token 並更新 `.env.wrangler.local`。

### 4) API 還是舊資料

最常見原因是你在看 local API，但資料其實只更新到 remote（或反過來）。先做這兩步：

```bash
npm run d1:status:remote
npm run d1:status:local
```

若 `payload_size` 或 `updated_at` 不一致，先執行：

```bash
npm run d1:sync:from-remote
```

### 5) 本地 API 經過 Nginx 回 502

請確認 Worker 不是只綁在 `127.0.0.1`，要用：

```bash
npx wrangler dev --local --ip 0.0.0.0 --port 8787
```

### 6) `no such table: sqlite_sequence: SQLITE_ERROR`

這通常出現在把 `wrangler d1 export` 的 SQL 直接匯入 local D1。請使用：

```bash
npm run d1:sync:from-remote
```

此腳本會自動清理 `sqlite_sequence` 相關語句，再進行匯入。
