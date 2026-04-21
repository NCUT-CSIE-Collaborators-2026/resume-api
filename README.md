# Resume API (Hono + Cloudflare D1)

這個服務提供履歷資料 API，資料來源為 D1 的 `resume_i18n_content`。

## 核心端點

- `GET /api/resume/v0/health`
- `GET /api/resume/v0/content.i18n`
- `GET /api/resume/v0/openapi.json`
- `GET /api/resume/v0/docs`

## 快速啟動

```bash
npm install
npm run dev:local
```

## 唯一流程文件（Wrangler First）

請只依這份執行 D1 操作：

- `D1_SYNC_FLOW.md`

此文件僅保留 Wrangler 指令流程，已移除自製 Python/暫存 SQL 腳本路徑。

## 可用指令

```bash
npm run build
npm run deploy
npm run d1:auth:check
npm run d1:init:remote
npm run d1:init:local
npm run d1:status:remote
npm run d1:status:local
npm run d1:sync:from-remote
npm run d1:prune:card-content
npm run d1:audit:card-content
npm run d1:backfill:seed
```
