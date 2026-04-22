# Resume API 完整開發指南

履歷 API 服務，基於 Hono + Cloudflare D1，提供國際化內容管理和用戶認證功能。

---

## 📋 目錄

1. [核心功能](#核心功能)
2. [快速啟動](#快速啟動)
3. [可用指令](#可用指令)
4. [本地開發認證](#本地開發認證)
5. [數據庫操作流程](#數據庫操作流程)
6. [故障排除](#故障排除)

---

## 核心功能

### API 端點

- `GET /api/resume/v0/health` - 健康檢查
- `GET /api/resume/v0/content.i18n` - 獲取國際化內容
- `GET /api/resume/v0/openapi.json` - OpenAPI 規範
- `GET /api/resume/v0/docs` - API 文檔

### 技術棧

| 組件 | 說明 |
|------|------|
| **框架** | Hono.js |
| **數據庫** | Cloudflare D1 |
| **ORM** | Drizzle |
| **認證** | Google OAuth / DEV 快速模式 |
| **運行時** | Cloudflare Workers |

### 核心表結構

```sql
CREATE TABLE resume_i18n_content (
  lang_code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

---

## 快速啟動

### 系統要求

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare 帳號（遠端操作）

### 本地開發環境

```bash
# 1. 進入項目目錄
cd /opt/other-project/resume-api

# 2. 安裝依賴
npm install

# 3. 本地開發（使用本地 D1）
npm run dev:local

# 或使用 Wrangler 直接運行
npm run dev
```

開發服務器會在 `http://127.0.0.1:8787` 上運行。

### 部署到生產環境

```bash
npm run deploy
```

---

## 可用指令

### 構建和部署

```bash
npm run build           # TypeScript 編譯檢查
npm run deploy          # 部署到 Cloudflare Workers
```

### 本地開發

```bash
npm run dev            # 啟動 Wrangler 開發服務器
npm run dev:local      # 啟動本地模式（含本地 D1）
```

### 數據庫遷移

```bash
npm run db:generate                # 從 schema 生成遷移文件
npm run db:migrate:local           # 本地應用遷移
npm run db:migrate:remote          # 遠端應用遷移
```

### 數據庫初始化

```bash
npm run d1:init:local              # 初始化本地表結構
npm run d1:init:remote             # 初始化遠端表結構
npm run d1:auth:check              # 檢查遠端認證狀態
```

### 數據庫查詢

```bash
npm run d1:status:local            # 查看本地數據
npm run d1:status:remote           # 查看遠端數據
npm run d1:sync:from-remote        # 從遠端同步到本地
```

### 數據管理

```bash
npm run d1:prune:card-content      # 清理卡片內容
npm run d1:audit:card-content      # 審計卡片內容
npm run d1:backfill:seed           # 回填示例數據
```

---

## 本地開發認證

### 概述

在本地開發環境中，可以啟用 **DEV 模式** 來跳過 Google OAuth 流程，直接返回 JWT token。這樣可以快速測試需要認證的功能，無需配置 Google OAuth。

### 啟用 DEV 模式

#### 1. 配置 `.dev.vars.local`

編輯 `.dev.vars.local` 文件，確保以下變數已設置：

```env
# DEV 模式快速認證（本地開發）
DEV_MODE=true
DEV_USER_EMAIL=dev@example.com
DEV_USER_NAME=Dev User
```

#### 2. 啟動開發服務器

```bash
npm run dev
```

或使用本地模式：

```bash
npm run dev:local
```

### 認證流程對比

#### 正常流程（生產/非 DEV 模式）

```
前端 → GET /auth/google/login 
     ↓
後端 → 重定向到 Google OAuth 登入
     ↓
使用者授權後 → 回呼 /auth/google/callback
     ↓
後端生成 JWT，設置 session cookie
     ↓
前端重定向到成功頁面
```

#### DEV 模式流程

```
前端 → GET /auth/google/login
     ↓
後端檢測 DEV_MODE=true
     ↓
直接生成 JWT（使用 DEV_USER_EMAIL 和 DEV_USER_NAME）
     ↓
設置 session cookie
     ↓
前端重定向到成功頁面
```

### 測試認證

#### 透過瀏覽器測試

1. 啟動開發服務器：`npm run dev`
2. 打開前端應用
3. 點擊登入按鈕，選擇 "Sign in with Google"
4. 前端會呼叫 `/api/resume/v0/auth/google/login`
5. DEV 模式下會立即返回重定向，跳過 Google OAuth

#### 驗證認證狀態

訪問受保護的端點來驗證認證：

```bash
curl -b "resume_session=<your-token>" \
  http://127.0.0.1:8787/api/resume/v0/auth/google/me
```

### DEV 模式配置選項

| 變數 | 說明 | 預設值 | 必須 |
|------|------|--------|------|
| `DEV_MODE` | 啟用 DEV 快速認證 | `false` | 否 |
| `DEV_USER_EMAIL` | 模擬使用者的郵箱 | `dev@example.com` | 否 |
| `DEV_USER_NAME` | 模擬使用者的名字 | `Dev User` | 否 |
| `JWT_SECRET` | JWT 簽名密鑰 | - | **是** |
| `GOOGLE_OAUTH_SUCCESS_REDIRECT` | 登入成功後的重定向地址 | - | **是** |

### 重要提示

⚠️ **DEV 模式只應在本地開發環境使用，絕不要在生產環境啟用！**

- DEV 模式完全跳過 Google OAuth 驗證
- JWT 由本地簽發，不經過 Google 驗證
- 適合快速本地測試和開發
- 部署到生產環境前，確保 `DEV_MODE=false`

### 切換回 Google OAuth

如果想在本地測試完整的 Google OAuth 流程：

1. 在 `.dev.vars.local` 中設置 `DEV_MODE=false`
2. 確保配置了有效的 Google OAuth 憑證：
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
3. 重新啟動開發服務器

---

## 數據庫操作流程

### 工作原理

該項目使用 Drizzle ORM 和 Wrangler 進行數據庫操作：

- **ORM**: Drizzle (D1 driver)
- **遷移管理**: Drizzle 生成，Wrangler 執行
- **配置文件**: `wrangler.toml` 的 `migrations_dir` 指向 `drizzle/migrations`

### 文件位置

- Schema: `src/db/schema.ts`
- Client: `src/db/client.ts`
- Drizzle 配置: `drizzle.config.ts`
- 遷移文件: `drizzle/migrations`

### 設置遠端操作憑證

遠端 D1 操作（與 Cloudflare 的互動）需要認證：

#### 1. 建立憑證文件

```bash
cp .env.wrangler.local.example .env.wrangler.local
```

#### 2. 編輯憑證文件

編輯 `.env.wrangler.local`，內容格式如下：

```bash
export CLOUDFLARE_API_TOKEN="<real_token>"
export CLOUDFLARE_ACCOUNT_ID="<real_account_id>"
```

獲取憑證：
- `CLOUDFLARE_API_TOKEN`: [Cloudflare 儀表板](https://dash.cloudflare.com/profile/api-tokens) → 建立令牌
- `CLOUDFLARE_ACCOUNT_ID`: [Cloudflare 儀表板](https://dash.cloudflare.com) → 帳戶 ID

#### 3. 載入憑證並驗證

```bash
source .env.wrangler.local
npm run d1:auth:check
```

### 初始化數據庫

#### 第一次設置或新環境

```bash
# 方式 1：使用遷移（推薦）
npm run db:migrate:local
npm run db:migrate:remote

# 方式 2：使用初始化腳本（備用）
npm run d1:init:local
npm run d1:init:remote
```

建議優先使用 `db:migrate:*`，`d1:init:*` 作為相容備援。

### 查看數據庫狀態

```bash
npm run d1:status:local
npm run d1:status:remote
```

重點說明：
- `--remote` 是 Cloudflare 遠端 D1 資料庫
- `--local` 是本機 `.wrangler/state/v3/d1` 資料庫

### 同步遠端數據到本地

```bash
npm run d1:sync:from-remote
npm run d1:status:remote
npm run d1:status:local
```

預期結果：`lang_code`、`payload_size`、`updated_at` 應接近一致。

### 寫入數據到遠端

#### 數據來源

常見數據來源：
- 繁體中文 (zh_TW): `/opt/other-project/resume-skeleton/src/app/newdata`
- 英文 (en): `/tmp/newdata.en.json`

#### 使用 Wrangler 直接寫入

```bash
cd /opt/other-project/resume-api
source .env.wrangler.local

# 準備數據
EN_PAYLOAD=$(cat /tmp/newdata.en.json | sed "s/'/''/g")
ZH_PAYLOAD=$(cat /opt/other-project/resume-skeleton/src/app/newdata | sed "s/'/''/g")

# 寫入遠端 D1（使用 UPSERT）
npx wrangler d1 execute DB --remote --command \
  "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('en', '${EN_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y

npx wrangler d1 execute DB --remote --command \
  "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('zh_TW', '${ZH_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y
```

如果網路中斷，直接重跑同一組 Wrangler 指令即可。

### 寫入後驗證

```bash
# 查看遠端和本地數據大小
source .env.wrangler.local
npx wrangler d1 execute DB --remote --command \
  "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content WHERE lang_code IN ('en','zh_TW') ORDER BY lang_code;" -y

npx wrangler d1 execute DB --local --command \
  "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content WHERE lang_code IN ('en','zh_TW') ORDER BY lang_code;"
```

#### 驗證標準

1. 先確認遠端有 `en` 與 `zh_TW` 兩筆記錄
2. 比對本地/遠端的 `payload_size`
3. 若只差 1 byte，通常是尾端換行差異，可接受但需記錄

### 最短可靠流程

```bash
cd /opt/other-project/resume-api
source .env.wrangler.local

# 1. 驗證認證
npm run d1:auth:check

# 2. 初始化表結構
npm run d1:init:remote
npm run d1:init:local

# 3. 同步遠端到本地
npm run d1:sync:from-remote

# 4. 準備和寫入數據
EN_PAYLOAD=$(cat /tmp/newdata.en.json | sed "s/'/''/g")
ZH_PAYLOAD=$(cat /opt/other-project/resume-skeleton/src/app/newdata | sed "s/'/''/g")

npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('en', '${EN_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y

npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('zh_TW', '${ZH_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y

# 5. 驗證結果
npm run d1:status:remote
npm run d1:status:local
```

---

## 故障排除

### 認證問題

#### 問題：DEV 模式不生效

**檢查清單：**
- 確認 `.dev.vars.local` 中 `DEV_MODE=true`
- 確認 `JWT_SECRET` 已設置
- 運行 `npm run dev` 時是否有錯誤訊息
- 檢查 `.dev.vars` 是否正確生成了這些變數

#### 問題：登入後仍然無法訪問受保護資源

**可能原因：**
- Cookie 設置不正確
- JWT 過期
- CORS 配置問題

**解決方案：**
1. 檢查瀏覽器開發工具的 Cookies 中是否有 `resume_session`
2. 檢查 `CORS_ORIGINS` 是否包含前端域名
3. 重新登入，獲取新的 JWT

### 數據庫問題

#### 錯誤：`Authentication error [code: 10000]`

**原因：** Token 權限不足或 token/account 不匹配

**解決方案：**
```bash
# 重新確認 .env.wrangler.local 並 source
source .env.wrangler.local
npm run d1:auth:check
```

#### 錯誤：`Could not route ... [code: 7003]`

**原因：** `CLOUDFLARE_ACCOUNT_ID` 錯誤或仍是占位符

**解決方案：**
- 確認 `.env.wrangler.local` 中的 Account ID 正確

#### 錯誤：`Invalid format for Authorization header [code: 6111]`

**原因：** `CLOUDFLARE_API_TOKEN` 格式錯誤

**解決方案：**
- 檢查 API Token 是否完整且未損壞

#### 問題：本地有數據，遠端沒有變化

**原因：** 可能只執行了 `--local`，未執行 `--remote`

**解決方案：**
```bash
# 重新執行遠端寫入
source .env.wrangler.local
npm run d1:auth:check
npm run d1:sync:from-remote
npm run d1:status:remote
```

### 構建問題

#### 錯誤：TypeScript 編譯失敗

```bash
npm run build
```

查看輸出中的具體錯誤，通常是類型不匹配或缺少模組。

#### 錯誤：Wrangler 部署失敗

```bash
# 檢查憑證
source .env.wrangler.local
npm run d1:auth:check

# 重新嘗試部署
npm run deploy
```

### 網路連線問題

#### 遠端操作中斷

遠端 D1 操作可以安全重試：

```bash
# 中斷的同一組指令可以直接重跑
source .env.wrangler.local
npx wrangler d1 execute DB --remote --command "SELECT * FROM resume_i18n_content;" -y
```

---

## 文件結構

```
resume-api/
├── src/
│   ├── index.ts                    # 應用入口
│   ├── app.types.ts                # 型別定義
│   ├── main.controller.ts          # 路由控制器
│   ├── main.service.ts             # 業務邏輯
│   ├── db/
│   │   ├── client.ts               # D1 客戶端
│   │   └── schema.ts               # Drizzle Schema
│   └── services/
│       ├── auth.service.ts         # 認證服務
│       ├── config.service.ts       # 配置服務
│       └── api-docs.service.ts     # OpenAPI 文檔
├── drizzle/
│   └── migrations/                 # 數據庫遷移文件
├── scripts/
│   ├── dev-run.sh                  # 開發服務器啟動腳本
│   ├── dev-local.sh                # 本地開發腳本
│   ├── dev-vars-compose.sh         # 環境變數合成腳本
│   └── d1-*.sh                     # 數據庫操作腳本
├── .dev.vars.local                 # 本地開發變數（勿提交）
├── .dev.vars.secret                # 秘密變數（勿提交）
├── wrangler.toml                   # Wrangler 配置
└── package.json                    # 項目配置

```

---

## 貢獻指南

1. **開發前**：確保本地開發環境正確設置
2. **修改後**：執行 `npm run build` 檢查編譯
3. **提交前**：確保沒有遺留調試代碼
4. **測試**：在 DEV 模式下充分測試認證流程

---

## 常見問題 (FAQ)

**Q: 如何在生產環境中禁用 DEV 模式？**  
A: 在 `wrangler.toml` 中設置 `DEV_MODE = "false"`，或確保 `.env.wrangler.local` 未載入。

**Q: DEV 模式下生成的 JWT 何時過期？**  
A: 預設 8 小時後過期，由 `SESSION_TTL_SECONDS = 60 * 60 * 8` 控制。

**Q: 如何更改模擬使用者的信息？**  
A: 編輯 `.dev.vars.local` 中的 `DEV_USER_EMAIL` 和 `DEV_USER_NAME`，重啟開發服務器即可。

**Q: 遠端 D1 資料庫如何備份？**  
A: 使用 `npm run d1:sync:from-remote` 下載到本地，或在 Cloudflare 儀表板中手動匯出。

---

**最後更新**：2026-04-22  
**維護者**：Resume API 開發團隊
