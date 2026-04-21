# 旅遊規劃 App — Monorepo

- `apps/web/`：Vite + React + TS（原 `trip-planner-buddy-50-main`）
- `apps/api/`：Express 5 + Prisma + Redis + BullMQ
- `packages/shared-types/`、`packages/shared-schema/`、`packages/api-client/`

## 快速啟動

```bash
# 0. 先複製環境變數
cp .env.example .env

# 1. 啟動 postgres / redis / minio
docker compose up -d

# 2. 安裝依賴 (需 Node 20.11+，npm 10+ 內建 workspaces)
npm install

# 3. 建立 schema + 種子 admin
#    本機第一次（互動建立 baseline migration）：
npm run db:generate -w @trip-planner/api
#    或部署時直接套既有 migration + CHECK constraint：
# npm run db:migrate -w @trip-planner/api
npm run db:seed -w @trip-planner/api

# 4. 同時跑 web (5173) 與 api (3000)
npm run dev
```

## 目錄

```
apps/
  web/    Vite SPA (原 trip-planner-buddy-50-main)
  api/    Express 5 API：routes / services / db / cache / queue / middleware / storage
    prisma/
      schema.prisma         Prisma DSL（@map 對到既有 snake_case 欄位）
      sql/check_constraints.sql   DSL 表達不了的 CHECK constraint
      migrations/           prisma migrate 產生的 SQL
    scripts/
      applyCheckConstraints.ts    db:migrate 完跑一次，套 CHECK
      reseedReminders.ts          重建 BullMQ delayed jobs
    src/db/seed.ts          初始 admin
packages/
  shared-types/    Trip / Expense / TodoItem ...= 名詞（DTO，資料形狀）
  shared-schema/   Zod schemas 前後端共用= 規則（Validator，這個形狀對不對）
  api-client/      前端用的 typed fetch client= 動詞（Client，怎麼把這個形狀送過去 / 拿回來）
docker-compose.yml postgres + redis + minio + minio bucket 自動建立
```

## 技術選型

| 層 | 選用 |
|---|---|
| Workspace | npm workspaces + Turborepo |
| 後端 | Express 5、Prisma、Zod、`ioredis`、BullMQ、`jsonwebtoken`、`bcrypt` |
| 前端 | Vite + React 18 + shadcn/ui + React Query（沿用原有） |
| 儲存 | PostgreSQL 16、Redis 7、MinIO（S3 相容） |

## 常用腳本

- `npm run dev`：同時跑 api 與 web。
- `npm run build`：全部 build。
- `npm run lint` / `npm run typecheck` / `npm test`。
- `npm run db:generate -w @trip-planner/api`：由 Prisma schema 生成 migration SQL（`prisma migrate dev`）。
- `npm run db:migrate -w @trip-planner/api`：把 migration 套到 `DATABASE_URL`（`prisma migrate deploy`）並追加 CHECK constraint（`scripts/applyCheckConstraints.ts`）。
- `npm run db:seed -w @trip-planner/api`：建立初始 admin（讀 `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`）。
- `npm run db:studio -w @trip-planner/api`：開 Prisma Studio。
- `npm run worker:reminder -w @trip-planner/api`：以獨立 process 跑 BullMQ reminder worker（生產環境推薦）。

## 文件

- [`docs/MIGRATION.md`](docs/MIGRATION.md) — 從舊 Supabase 專案把資料搬到本 monorepo 的步驟（schema、data、storage、提醒重排）
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md) — 驗證 checklist：docker / db / dev server / 端到端流程 / 上線前 smoke
