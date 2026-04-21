# 旅遊規劃 App — Monorepo

前後端分離重構版。原前端在 `C:/Users/PC/programing/trip`（分支 `develop_roy`）。

- `apps/web/`：Vite + React + TS（原 `trip-planner-buddy-50-main`）
- `apps/api/`：Express 5 + Drizzle + Redis + BullMQ
- `packages/shared-types/`、`packages/shared-schema/`、`packages/api-client/`

## 快速啟動

```bash
# 0. 先複製環境變數
cp .env.example .env

# 1. 啟動 postgres / redis / minio
docker compose up -d

# 2. 安裝依賴 (需 Node 20.11+ 與 pnpm 9+)
pnpm install

# 3. 建立 schema + 種子 admin
pnpm db:migrate
pnpm db:seed

# 4. 同時跑 web (5173) 與 api (3000)
pnpm dev
```

## 目錄

```
apps/
  web/    Vite SPA (原 trip-planner-buddy-50-main)
  api/    Express 5 API：routes / services / db / cache / queue / middleware / storage
packages/
  shared-types/    Trip / Expense / TodoItem ...
  shared-schema/   Zod schemas 前後端共用
  api-client/      前端用的 typed fetch client
db/
  migrations/      Drizzle migration SQL
  seed.ts          初始 admin + dev seed data
docker-compose.yml postgres + redis + minio + minio bucket 自動建立
```

## 技術選型

| 層 | 選用 |
|---|---|
| Workspace | pnpm workspaces + Turborepo |
| 後端 | Express 5、Drizzle、Zod、`ioredis`、BullMQ、`jsonwebtoken`、`bcrypt` |
| 前端 | Vite + React 18 + shadcn/ui + React Query（沿用原有） |
| 儲存 | PostgreSQL 16、Redis 7、MinIO（S3 相容） |

## 常用腳本

- `pnpm dev`：同時跑 api 與 web。
- `pnpm build`：全部 build。
- `pnpm lint` / `pnpm typecheck` / `pnpm test`。
- `pnpm db:generate`：由 Drizzle schema 生成 migration SQL。
- `pnpm db:migrate`：把 migration 套到 `DATABASE_URL`。
- `pnpm db:seed`：建立初始 admin（讀 `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`）。

## 文件

- [`docs/MIGRATION.md`](docs/MIGRATION.md) — 從舊 Supabase 專案把資料搬到本 monorepo 的步驟（schema、data、storage、提醒重排）
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — 驗證 checklist：docker / db / dev server / 端到端流程 / 上線前 smoke
