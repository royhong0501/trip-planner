# Trip Planner — Monorepo

旅遊規劃 App（前後端 + 共用合約 + 維運腳本）。後端使用 **Nest.js 10**（自 Express 5 遷移），資料層 Prisma，背景任務 BullMQ + Redis，物件儲存 MinIO（S3 相容）。

- **`apps/web/`** — Vite + React 18 + shadcn/ui + React Query（前端 SPA）
- **`apps/api/`** — Nest.js 10（Module/Controller/Service）+ Prisma + Zod + BullMQ + Passport-JWT
- **`packages/shared-types/`** — 純 TypeScript 介面（domain types + DB row mappers）
- **`packages/shared-schema/`** — Zod schemas（前後端共用驗證）
- **`packages/api-client/`** — typed fetch 包裝（前端用）

> **架構里程碑**：原本 `apps/api` 是手刻 Express 5。已於 2026-04 全面遷移到 Nest.js，採用 feature-based module、@Global Prisma/Redis、`@nestjs/bullmq` Processor、`@nestjs/throttler` 取代 `express-rate-limit`、`nestjs-zod` 取代手刻 `validate` middleware。**對外 HTTP 契約零變更**（17 個端點、JSON shape、`tp_admin` cookie、錯誤格式都不動），所以 `apps/web` 與 `packages/api-client` 完全不需要改。

---

## 快速啟動

```bash
# 0. 環境變數（先複製再依需要修改）
cp .env.example .env

# 1. 啟動 postgres / redis / minio（含自動建 bucket）
docker compose up -d

# 2. 安裝依賴（Node 20.11+，npm 10+ 內建 workspaces）
npm install

# 3. 建立 schema + 種第一個 admin
#    開發初次：
npm run db:generate -w @trip-planner/api    # prisma migrate dev（互動）
#    或部署時直接套既有 migration + CHECK constraints：
# npm run db:migrate -w @trip-planner/api
npm run db:seed -w @trip-planner/api

# 4. 同時跑 web (5173) 與 api (3000)
npm run dev
```

驗證 API 啟動：

```bash
curl http://localhost:3000/health
# {"status":"ok","env":"development","time":"..."}
```

驗證前端：開瀏覽器到 `http://localhost:5173`。

---

## 目錄概覽

```
trip-planner/
├── apps/
│   ├── api/                Nest.js 10 後端（main.ts → AppModule → feature modules）
│   └── web/                Vite + React 前端
├── packages/
│   ├── shared-types/       domain types + row mappers
│   ├── shared-schema/      zod 驗證 schema
│   └── api-client/         前端 typed fetch wrapper
├── docs/                   詳細維運文件（見下方索引）
├── docker-compose.yml      postgres + redis + minio + minio-init
├── package.json            npm workspaces 主檔
├── turbo.json              Turborepo 任務 pipeline
├── tsconfig.base.json      TS 共用設定（strict、ES2022、NodeNext）
└── prettier.config.cjs
```

完整結構請見 [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)。

---

## 技術選型

| 層 | 選用 | 備註 |
|---|---|---|
| Workspace | npm workspaces + Turborepo 2 | 根目錄 `npm run dev/build/test/typecheck` 全跑 |
| 後端框架 | Nest.js 10 + Express adapter | `@nestjs/platform-express`，保留 helmet/cors/cookieParser/compression |
| 後端 ORM | Prisma 5 | `@map(...)` 對到 snake_case 欄位；JSONB 用 `@db.JsonB` |
| 後端驗證 | Zod + `nestjs-zod` | `ZodValidationPipe(schema)` 取代手刻 validate middleware |
| 後端 Auth | passport-jwt + cookie 雙抽取 | `tp_admin` httpOnly cookie 或 `Authorization: Bearer` |
| 後端限流 | `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` | 取代 `express-rate-limit` + `rate-limit-redis` |
| 背景任務 | `@nestjs/bullmq` (`@Processor`) | jobId `reminder:{todoId}`，內嵌或獨立行程兩種模式 |
| 物件儲存 | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | presigned PUT URL，MinIO 相容 |
| 前端 | Vite + React 18 + shadcn/ui + React Query | 沿用原有，無變動 |
| 資料庫 / 快取 | PostgreSQL 16、Redis 7、MinIO（最新版） | `docker-compose.yml` |

---

## 環境變數

完整清單見 `.env.example`。新版（Nest.js）新增了一個變數：

| 變數 | 用途 | 預設 |
|---|---|---|
| `ENABLE_EMBEDDED_WORKER` | API 程序內是否同時跑 BullMQ Processor | `true`（dev 適用）；生產環境若用獨立 worker，請設 `false` |

其餘（`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`S3_*`、`BREVO_*`、`OPENWEATHER_API_KEY`、`CORS_ORIGIN`、`COOKIE_*`、`ADMIN_SEED_*`）與舊版完全相同。env 由 `apps/api/src/config/env.schema.ts` 用 zod 驗證，**啟動時 fail-fast**。

---

## 常用腳本

### 根目錄

| 腳本 | 行為 |
|---|---|
| `npm run dev` | 同時跑 api 與 web（Turborepo） |
| `npm run build` | 全部 build（產 `apps/api/dist/` 與 `apps/web/dist/`） |
| `npm run typecheck` | 全部跑 `tsc --noEmit` |
| `npm run lint` | ESLint（如有設定的子 workspace） |
| `npm test` | 跑所有 workspace 的 vitest |

### `apps/api`（透過 `-w @trip-planner/api`）

| 腳本 | 行為 |
|---|---|
| `dev` | `tsx watch src/main.ts` — 熱重載開發伺服器 |
| `start` | `node dist/main.js` — production 模式（先 `build`） |
| `build` | `prisma generate && tsc -p tsconfig.json` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run`（執行 `test/**/*.e2e-spec.ts`） |
| `test:watch` | `vitest`（watch 模式） |
| `db:generate` | `prisma migrate dev` — 開發環境互動建立 migration |
| `db:migrate` | `prisma migrate deploy` 後跑 `applyCheckConstraints.ts` |
| `db:seed` | `tsx src/db/seed.ts` — 建立第一個 admin |
| `db:studio` | 開 Prisma Studio |
| `worker:reminder` | `tsx watch src/workers/reminder.entry.ts` — 獨立行程跑 BullMQ Worker |

### `apps/web`（透過 `-w @trip-planner/web`）

| 腳本 | 行為 |
|---|---|
| `dev` | Vite dev server（5173），`/api/*` proxy 到 3000 |
| `build` | Vite production build |
| `preview` | 本地預覽 build 後的 dist |
| `test` | Vitest（jsdom） |

---

## 後端架構速覽（Nest.js）

```
apps/api/src/
├── main.ts                          # NestFactory.create + 全域 middleware/filter
├── app.module.ts                    # 根 Module，組合所有 feature module
├── common/                          # 跨模組基礎建設
│   ├── exceptions/http.exception.ts # HttpError（繼承 HttpException），保留靜態工廠語意
│   ├── filters/http-exception.filter.ts # 全域，HttpError + ZodError + ThrottlerException
│   ├── pipes/zod-validation.pipe.ts # @Body(new ZodValidationPipe(schema))
│   ├── guards/admin.guard.ts        # passport-jwt 包裝，分辨「沒帶 token / 過期 / 無效」
│   └── decorators/current-admin.decorator.ts # @CurrentAdmin() 取得 token payload
├── config/
│   ├── env.schema.ts                # Zod schema + parseEnv()
│   └── config.module.ts             # @Global，提供 APP_CONFIG token
├── modules/
│   ├── prisma/                      # @Global，PrismaService extends PrismaClient
│   ├── redis/                       # @Global，REDIS_CLIENT + BULL_CONNECTION
│   ├── auth/                        # JwtStrategy + AuthService + AuthController
│   ├── reminder/                    # @Global，ReminderQueueService + Processor
│   ├── admin-users/ trips/ todos/ participants/ expenses/
│   ├── homepage/ weather/ uploads/
│   └── health/                      # GET /health
└── workers/reminder.entry.ts        # 獨立 worker 入口（createApplicationContext）
```

對外 17 個 HTTP 端點對應位置，請見 [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)。

---

## 文件索引

| 文件 | 內容 |
|---|---|
| [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) | 完整目錄結構、Nest.js 模組職責、HTTP 端點 ↔ Controller 對照、一個請求穿越系統的路徑、速記表 |
| [`docs/DATABASE.md`](docs/DATABASE.md) | 8 張表的詳細欄位、設計邏輯、JSONB 用法、CHECK 約束、外鍵級聯策略、Decimal 精度、UUID 策略、常用維運查詢 |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | 上線前驗證 checklist：docker / DB / typecheck / e2e / 端到端使用者流程 / production smoke |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | 兩段式遷移紀錄：①舊 Supabase → 自架 Postgres（資料遷移），②Express 5 → Nest.js（框架遷移） |

---

## 故障排除

| 症狀 | 通常原因 | 處理 |
|---|---|---|
| API 啟動時 `Invalid environment variables` | `.env` 缺欄位或 `JWT_SECRET` 短於 32 字元 | 對照 `.env.example`，必要時 `openssl rand -base64 48` 生成 |
| `prisma generate` 卡在 download | postinstall 卡網 | 設 `PRISMA_ENGINES_MIRROR` 或在公司網路重試 |
| 前端登入後 cookie 沒帶上 | dev 跨埠 cookie / SameSite | 已用 Vite proxy，請確認瀏覽器訪問 `localhost:5173` 而非 `127.0.0.1` |
| BullMQ 沒寄信 | `ENABLE_EMBEDDED_WORKER=false` 但沒跑 `worker:reminder` | 兩擇一啟用 |
| 限流訊息變英文 | 自訂 ThrottlerGuard 沒攔截 | 已由 `HttpExceptionFilter` 把 `ThrottlerException` 轉成「太多請求，請稍候再試」 |

---

## 授權與貢獻

Private project（沒有公開 license）。提交 PR 前請確認：

1. `npm run typecheck` 全綠
2. `npm test -w @trip-planner/api` 全綠（目前 7 個 spec 涵蓋 health/auth/trips；新增功能請補對應 e2e spec）
3. `npm run lint`
4. 沒有把 `.env` 或 `*.local` 進版控
