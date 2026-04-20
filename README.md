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
├─ .dev.vars                        # 本機機密：不要上傳 Git
├─ src/
│  └─ index.ts                      # 必備：API 入口與路由
├─ scripts/
│  ├─ dev-local.sh                  # 建議：本地開發啟動
│  ├─ d1-auth-check.sh              # 建議：憑證檢查
│  └─ d1-sync-from-remote.sh        # 建議：遠端同步到本地
├─ node_modules/                    # 執行產物：npm install 後產生
├─ .wrangler/                       # 執行產物：wrangler 本地狀態
├─ .tmp/                            # 執行產物：D1 匯出/匯入中間檔
└─ wrangler.log                     # 執行產物：wrangler 日誌
```

說明：

- 可提交到 Git：`src/`、`scripts/`、`package.json`、`wrangler.toml`、`.env.wrangler.local.example`
- 不可提交到 Git：`.env.wrangler.local`、`.dev.vars`、`.wrangler/`、`.tmp/`、`node_modules/`、`wrangler.log`
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
npx wrangler d1 create resume-api-db
```

### 驗證資料

```bash
npm run d1:status:remote
npm run d1:status:local
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
