# D1 Sync Flow (Wrangler Only)

本文件是 `resume-api` 唯一操作流程說明，且只使用 Wrangler 指令。

適用範圍：
- Cloudflare D1 綁定：`DB`
- D1 資料庫名稱：`resume-api-db`
- 資料表：`resume_i18n_content`

## 0. 進入專案根目錄

```bash
cd /opt/other-project/resume-api
```

## 1. 設定憑證（遠端操作必做）

1. 建立本機憑證檔（若尚未建立）：

```bash
cp .env.wrangler.local.example .env.wrangler.local
```

2. 編輯 `.env.wrangler.local`，內容格式如下：

```bash
export CLOUDFLARE_API_TOKEN="<real_token>"
export CLOUDFLARE_ACCOUNT_ID="<real_account_id>"
```

3. 載入憑證並檢查：

```bash
source .env.wrangler.local
npm run d1:auth:check
```

## 2. 初始化表結構（首次或新環境）

```bash
npm run d1:init:remote
npm run d1:init:local
```

## 3. 查看 local / remote 狀態

```bash
npm run d1:status:remote
npm run d1:status:local
```

重點：
- `--remote` 是 Cloudflare 遠端 D1。
- `--local` 是本機 `.wrangler/state/v3/d1`。

## 4. 從 remote 同步回 local（建議先做）

```bash
npm run d1:sync:from-remote
npm run d1:status:remote
npm run d1:status:local
```

預期：`lang_code`、`payload_size`、`updated_at` 接近一致。

## 5. 把資料寫到 remote（直接 Wrangler）

此專案常見來源：
- zh_TW: `/opt/other-project/resume-skeleton/src/app/newdata`
- en: `/tmp/newdata.en.json`

直接用 Wrangler 寫入（不建立 Python 腳本，不保存暫存 SQL 檔）：

```bash
cd /opt/other-project/resume-api
source .env.wrangler.local

EN_PAYLOAD=$(cat /tmp/newdata.en.json | sed "s/'/''/g")
ZH_PAYLOAD=$(cat /opt/other-project/resume-skeleton/src/app/newdata | sed "s/'/''/g")

npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('en', '${EN_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y
npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('zh_TW', '${ZH_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y
```

若網路中斷，直接重跑同一組 Wrangler 指令。

## 6. 寫入後驗證（必要）

```bash
source .env.wrangler.local
npx wrangler d1 execute DB --remote --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content WHERE lang_code IN ('en','zh_TW') ORDER BY lang_code;" -y
npx wrangler d1 execute DB --local --command "SELECT lang_code, length(payload) AS payload_size FROM resume_i18n_content WHERE lang_code IN ('en','zh_TW') ORDER BY lang_code;"
```

判讀原則：
- 先確認 remote 有 `en` 與 `zh_TW` 兩筆。
- 再比對 local/remote 的 `payload_size`。
- 若只差 1 byte，通常是尾端換行差異；可接受，但要記錄。

## 7. 常見錯誤快速排除

1. `Authentication error [code: 10000]`
- Token 權限不足或 token/account 不匹配。
- 重新確認 `.env.wrangler.local` 並 `source`。

2. `Could not route ... [code: 7003]`
- `CLOUDFLARE_ACCOUNT_ID` 錯誤或仍是占位符。

3. `Invalid format for Authorization header [code: 6111]`
- `CLOUDFLARE_API_TOKEN` 格式錯誤。

4. local 有資料、remote 沒變
- 可能只執行了 `--local`。
- 重跑 `--remote` 寫入並立即查 `d1:status:remote`。

## 8. 最短可靠流程

```bash
cd /opt/other-project/resume-api
source .env.wrangler.local
npm run d1:auth:check
npm run d1:init:remote
npm run d1:init:local
npm run d1:sync:from-remote
EN_PAYLOAD=$(cat /tmp/newdata.en.json | sed "s/'/''/g")
ZH_PAYLOAD=$(cat /opt/other-project/resume-skeleton/src/app/newdata | sed "s/'/''/g")
npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('en', '${EN_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y
npx wrangler d1 execute DB --remote --command "INSERT INTO resume_i18n_content (lang_code,payload,updated_at) VALUES ('zh_TW', '${ZH_PAYLOAD}', datetime('now')) ON CONFLICT(lang_code) DO UPDATE SET payload=excluded.payload, updated_at=datetime('now');" -y
npm run d1:status:remote
npm run d1:status:local
```
