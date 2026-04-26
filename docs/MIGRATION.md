# 兩段式遷移紀錄

這份文件記錄專案兩個重大遷移：

- **Part 1**：從舊 `trip-planner-buddy-50-main`（Supabase 專案）→ 自架 Postgres + 自寫後端的 monorepo（**資料層遷移**，2026-01）
- **Part 2**：從手刻 Express 5 → Nest.js 10 的後端框架重寫（**框架層遷移**，2026-04）

兩段獨立，先做完哪一段都可以。Part 1 是一次性歷史步驟（如果你已經在用本 monorepo，直接跳到 Part 2 或忽略整份）；Part 2 對後續維護有持續影響。

---

# Part 1: Supabase → 自架 Postgres

把舊版 `trip-planner-buddy-50-main`（Supabase 專案）的資料搬到本 monorepo 自架 Postgres 的步驟。包含欄位對應、RLS 清理、storage 物件遷移、提醒重排與驗證查詢。

## 1.1 事前準備

- 本機已能執行 `docker compose up`（Postgres / Redis / MinIO 會啟動）。
- 已在 `.env` 填好 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`S3_*`、`BREVO_API_KEY`、`OPENWEATHER_API_KEY`。
- 舊 Supabase 專案：取得 **Project Settings → Database → Connection string**（注意：搬資料請用「Session mode」的直連字串，**不要用 pgbouncer 6543 port**）。
- 安裝 `pg_dump` ≥ 16（對應本地 Postgres 版本）與 `mc`（MinIO client）。

## 1.2 匯出 Supabase schema + data

Supabase 內建很多內部 schema（`auth`、`storage`、`realtime`、`supabase_functions`…），**只搬 `public` schema**，其餘讓新環境自己建。

```bash
# 1) schema-only（僅結構）
pg_dump "$OLD_DB_URL" \
  --schema=public \
  --schema-only \
  --no-owner --no-privileges \
  -f old-public-schema.sql

# 2) data-only（僅資料）
pg_dump "$OLD_DB_URL" \
  --schema=public \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  -f old-public-data.sql
```

> `--no-owner --no-privileges` 避免把 Supabase 專屬的 role（`postgres`、`authenticated`、`anon`、`service_role`）一起帶過來。
>
> `--disable-triggers` 在匯入 data 時暫時關 FK check，避免子表先於母表插入而 fail。

## 1.3 清掉 RLS 與 Supabase 專屬物件

舊 `public` schema 裡塞了 Supabase 的 policy、trigger、RLS 開關，新 Postgres 不需要：

```bash
# 移除所有 CREATE POLICY / ALTER TABLE ... ENABLE ROW LEVEL SECURITY
grep -Ev '^(CREATE POLICY|ALTER TABLE .+ (ENABLE|DISABLE|FORCE) ROW LEVEL SECURITY|COMMENT ON POLICY|GRANT|REVOKE)' \
  old-public-schema.sql > old-public-schema.clean.sql
```

檢查 `old-public-schema.clean.sql` 是否還有下列要人工處理的項目：

- `CREATE EXTENSION` → 只保留 `pgcrypto`（for `gen_random_uuid()`）、`uuid-ossp`；其他（`vault`、`pgjwt`、`pg_graphql`…）刪掉。
- 參照 `auth.users` 的 FK → 這裡 `admin_users` 由我們自己的表取代，舊資料只搬 `trip_participants.user_id` 即可（可保留或清為 NULL）。
- 任何 `EXECUTE FUNCTION public.create_expense_with_splits(...)` 的 RPC 定義 → 刪掉，後端已改用 Prisma `$transaction`（Nest.js 版位於 `apps/api/src/modules/expenses/expenses.service.ts`）。

## 1.4 建立新 DB 結構

**不要直接套用清理後的舊 schema**——新 monorepo 用 Prisma 管結構，欄位型別和 constraint 已微調（例如 `@db.Decimal(14,2)` / `@db.Decimal(18,8)`、check constraint、`onDelete: Restrict` for `payerId`）。

```bash
# 本機第一次建表（development）
npm run db:generate -w @trip-planner/api   # prisma migrate dev

# 部署環境套 migration + 追加 CHECK constraint
npm run db:migrate -w @trip-planner/api    # prisma migrate deploy && applyCheckConstraints

# 建立第一個 admin（讀 ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD）
npm run db:seed -w @trip-planner/api
```

> `db:migrate` 會先跑 `prisma migrate deploy`，再跑 `apps/api/scripts/applyCheckConstraints.ts`（idempotent）。Prisma DSL 無法表達 CHECK constraint，所以抽到 `prisma/sql/check_constraints.sql` 由這支 script 套用。

## 1.5 匯入舊資料

新 schema 已建好，倒入 `old-public-data.sql` 的 `COPY ... FROM stdin;` 段落。欄位名幾乎一致（都是 snake_case），多數表直接 `\i` 就能進來：

```bash
psql "$NEW_DB_URL" -f old-public-data.sql
```

若遇到下列錯誤：

| 錯誤 | 原因 | 處理 |
|------|------|------|
| `relation "auth.users" does not exist` | 舊 data 有 FK 到 Supabase `auth.users` | 匯入前先 `psql -c "ALTER TABLE trip_participants DROP CONSTRAINT IF EXISTS trip_participants_user_id_fkey;"` |
| `invalid input syntax for type numeric` | `amount_total` 來源是 `numeric` 無 scale 限制 | 已手動 `ROUND` 一次再匯入，或直接讓 Postgres 轉型（14,2 會四捨五入） |
| `column "job_id" of relation "todos" does not exist` | 舊版沒有 BullMQ 對應欄位 | 正常。新欄位在 Prisma migration 中是 `NULL`，匯入後現有提醒用 §1.7 重新排程 |
| `violates check constraint "trips_category_check"` | 舊資料可能有空字串 | `UPDATE trips SET category = 'international' WHERE category = '';` 再重試 |

## 1.6 Storage（封面圖、首頁影片、LOGO、輪播）

舊專案用 Supabase Storage 的 `homepage-media` bucket。新環境用 MinIO。

```bash
# 1) 把舊 bucket 整包 sync 下來
npx supabase storage list-objects --bucket homepage-media > obj-list.txt
# （或 Supabase Dashboard → Storage → 下載全部）

# 2) 上傳到本地 MinIO
mc alias set local http://localhost:9000 $S3_ACCESS_KEY_ID $S3_SECRET_ACCESS_KEY
mc cp --recursive ./homepage-media-dump/ local/trip-planner/
```

把 DB 裡的舊 URL 批次改寫成新的 `S3_PUBLIC_BASE_URL`：

```sql
UPDATE trips
   SET cover_image = REPLACE(cover_image,
                             'https://xxxxxx.supabase.co/storage/v1/object/public/homepage-media',
                             current_setting('app.public_s3_url'))
 WHERE cover_image LIKE '%supabase.co/storage%';

UPDATE homepage_settings
   SET value = REPLACE(value::text,
                       'https://xxxxxx.supabase.co/storage/v1/object/public/homepage-media',
                       current_setting('app.public_s3_url'))::jsonb
 WHERE key IN ('site_logo', 'intro_video', 'carousel_slides');
```

> 沒搬 storage 也不會壞：前端仍會顯示舊 Supabase 的公開 URL（直到該專案被暫停）。但建議一次搬乾淨。

## 1.7 重建 BullMQ 提醒排程

舊版提醒由 Supabase Cron + Edge Function 依 `todos.remind_time` 檢查觸發。新版用 BullMQ，每筆提醒要有對應的 delayed job 才會寄信。

```bash
npm run -w @trip-planner/api exec -- tsx scripts/reseedReminders.ts
```

這支 script 掃描 `todos` 表，對 `remind_time > now()` 且 `is_notified = false` 的每一筆呼叫 `enqueueReminder(...)`（自帶獨立 ioredis 連線，不依賴 Nest.js 的 DI），把 jobId 寫回 `todos.job_id`。

> 第一次搬完後，到 BullMQ dashboard（若有開）看到 `trip-reminders` queue 有對應數量的 delayed job，即代表成功。

## 1.8 驗證 checklist

匯完資料後，依序跑這些查詢：

```sql
-- 行程數
SELECT COUNT(*) FROM trips;

-- 每個 trip 的 todos 數（抓 JSONB array length）
SELECT id, jsonb_array_length(todos) FROM trips ORDER BY id LIMIT 5;

-- 花費主檔 + 分帳一致性
SELECT e.id, e.amount_total, SUM(s.owed_amount)
  FROM expenses e
  LEFT JOIN expense_splits s ON s.expense_id = e.id
 GROUP BY e.id
 HAVING ABS(e.amount_total - COALESCE(SUM(s.owed_amount), 0)) > 0.01;

-- admin_users 至少有一筆（否則無法登入後台）
SELECT id, email FROM admin_users;

-- 提醒排程：有 remind_time 的 todo 應該有 job_id
SELECT COUNT(*) FROM todos
 WHERE remind_time > NOW() AND is_notified = false AND job_id IS NULL;
-- 期望 0；若 > 0，回到 §1.7 重新執行 reseedReminders
```

UI 端驗證見 [`docs/VERIFICATION.md`](VERIFICATION.md) §5。

## 1.9 退場（Supabase 專案停用）

確認以上 8 項都 OK、觀察數天沒問題後：

1. Supabase → Project Settings → **Pause project**（先 pause，不要直接 delete，留 7 天回滾空間）。
2. 前端 `.env` 徹底移除 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（本專案已不用，但舊 CI / 部署環境要一併清）。
3. 一週後 Supabase 專案 delete；同時刪掉 `apps/web/src/lib/supabase.ts` 這支「拋錯的 Proxy shim」—— 現在留著是為了讓任何漏改的呼叫以顯性 runtime error 出現（比靜默成功安全）。

---

# Part 2: Express 5 → Nest.js 10

於 2026-04 完成。動機、決策、檔案對映與風險點都記錄在這裡，方便之後 onboarding 與類似遷移參考。

## 2.1 動機

舊版 `apps/api` 是手刻 Express 5（`createApp()` + 9 個 `Router` + 6 個 service + 4 個 middleware）。隨資源增加，幾個痛點浮現：

1. **依賴注入**：`prisma`、`redis`、`bullConnection` 都是 module-level 全域 import，測試難以替換。
2. **模組化**：route + service + middleware 散落，缺乏清楚的 module 邊界。
3. **驗證 / Guard 統一**：`validate` middleware + `requireAdmin` 函式需要每個路由手動串。
4. **生命週期管理**：手刻 SIGINT/SIGTERM 收尾邏輯易漏關連線。
5. **測試空白**：0 個測試，趁框架轉換建立 e2e 地基。

## 2.2 對外契約：零變更

這是這次遷移最重要的設計約束。**所有 17 個 HTTP 端點**：

- 路徑、方法、status code 全部保留
- JSON 回應 shape（camelCase + nested objects）保留
- `tp_admin` httpOnly cookie 名稱 + `httpOnly`/`sameSite=lax`/`secure` 設定保留
- 錯誤格式 `{ error, details? }` 保留
- 限流 429 中文錯誤訊息保留
- BullMQ jobId `reminder:{todoId}` 命名規則保留
- Redis key prefix（`revoked_jti:`、`weather:`、`geocode:`、`rl:auth:`、`rl:ext:`）保留

結論：`apps/web`、`packages/api-client`、`packages/shared-types`、`packages/shared-schema` **都不需要改任何程式碼**。

## 2.3 技術決策

| 項目 | 選擇 | 理由 |
|---|---|---|
| Zod 整合 | `nestjs-zod` 思路，但實作為自寫 `ZodValidationPipe` | 直接從 `packages/shared-schema` import schemas，不需 createZodDto |
| Auth | `passport-jwt` + cookie / Bearer 雙抽取器 | 保留與舊 `requireAdmin` 完全一致的「沒帶 token / 過期 / 無效」錯誤分流 |
| 限流 | `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` | 取代 `express-rate-limit` + `rate-limit-redis`，相容性高 |
| BullMQ | `@nestjs/bullmq` 的 `@Processor` / `WorkerHost` | 取代手刻 Worker；保留 enqueueReminder/cancel 介面語意 |
| 測試框架 | Vitest（非 Nest 預設的 Jest） | 與 monorepo 既有 web 子專案一致，sw 透過 unplugin-swc 解 decorator metadata |
| Worker 模式 | 內嵌 + 獨立兩種都保留 | 由 `ENABLE_EMBEDDED_WORKER` 環境變數切換 |
| Build 工具 | `tsx watch` + `tsc -p tsconfig.json` | 不引入 Nest CLI runtime，沿用 monorepo 既有流程 |
| ESM | 維持（`"type": "module"`） | 與 `packages/*` 一致；裝飾器 emit 沒問題 |

## 2.4 檔案對映表

詳見 [`docs/PROJECT_STRUCTURE.md` §🎓 對照表](PROJECT_STRUCTURE.md#-nestjs-遷移與舊-express-結構的對照)。簡表：

| 舊（Express） | 新（Nest.js） |
|---|---|
| `src/server.ts` | `src/main.ts` |
| `src/app.ts createApp()` | `src/app.module.ts AppModule` |
| `src/routes/<feature>.ts` | `src/modules/<feature>/<feature>.controller.ts` |
| `src/services/<feature>.ts` | `src/modules/<feature>/<feature>.service.ts` |
| `src/middleware/validate.ts` | `src/common/pipes/zod-validation.pipe.ts` |
| `src/middleware/requireAdmin.ts` | `src/common/guards/admin.guard.ts` + `JwtStrategy` |
| `src/middleware/errorHandler.ts` | `src/common/filters/http-exception.filter.ts` |
| `src/middleware/rateLimit.ts` | `@nestjs/throttler` + `@Throttle` decorator |
| `src/utils/asyncHandler.ts` | （刪除，Nest 預設處理 async） |
| `src/utils/httpError.ts` | `src/common/exceptions/http.exception.ts`（繼承 HttpException） |
| `src/db/client.ts` | `src/modules/prisma/prisma.service.ts` |
| `src/cache/redis.ts` | `src/modules/redis/redis.service.ts` + `REDIS_CLIENT` token |
| `src/queue/connection.ts` | `BULL_CONNECTION` provider in RedisModule |
| `src/queue/reminderQueue.ts` | `ReminderQueueService` + `ReminderProcessor` |
| `src/queue/reminderWorker.ts` | `src/workers/reminder.entry.ts` |
| `src/storage/s3.ts` | `src/modules/uploads/s3.service.ts` |
| `src/config/env.ts` | `src/config/env.schema.ts` + `config.module.ts` |

## 2.5 套件變動

### 新增到 `apps/api/package.json` dependencies

- `@nestjs/core`、`@nestjs/common`、`@nestjs/platform-express`
- `@nestjs/jwt`、`@nestjs/passport`、`passport`、`passport-jwt`
- `@nestjs/bullmq`
- `@nestjs/throttler`、`@nest-lab/throttler-storage-redis`
- `nestjs-zod`（雖然最終實作未使用其 API，但保留以便未來啟用）
- `reflect-metadata`、`rxjs`

### 新增 devDependencies

- `@nestjs/testing`
- `@types/passport-jwt`
- `vitest-mock-extended`、`ioredis-mock`
- `@swc/core` + `unplugin-swc`（Vitest 解 decorator metadata）

### 移除

- `express-rate-limit`、`rate-limit-redis`（被 `@nestjs/throttler` 取代）

### 不動

- `@prisma/client`、`prisma`、`bullmq`、`ioredis`、`bcrypt`、`jsonwebtoken`、`zod`、`@aws-sdk/client-s3`、`helmet`、`compression`、`cors`、`cookie-parser`、`dotenv`、`express`

## 2.6 tsconfig 變動

```jsonc
// apps/api/tsconfig.json — 新增
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,    // Nest constructor injection 不喜歡 strict init
    "types": ["node", "reflect-metadata"]
  }
}
```

`scripts/` 拆出獨立 `scripts/tsconfig.json`，避免 `rootDir: src` 與 scripts 路徑衝突。

## 2.7 環境變數新增

僅一個：

| 變數 | 預設 | 用途 |
|---|---|---|
| `ENABLE_EMBEDDED_WORKER` | `true` | API 程序內是否同時跑 BullMQ Processor。生產若用獨立 worker 請設 `false`。 |

## 2.8 風險點與對應處置

遷移時刻意處理過、但日後改 code 容易踩到的點：

1. **`patchTodos` 的 `SELECT ... FOR UPDATE`**  
   位於 `apps/api/src/modules/trips/trips.service.ts`，用 `prisma.$queryRaw` 寫的原始 SQL。改 code 時要保留 `$transaction` 包覆，否則行鎖失效。

2. **Body parser 順序**  
   `main.ts` 用 `NestFactory.create(AppModule, { bodyParser: false })` 後再 `app.use(express.json({ limit: '10mb' }))`，因為 daily_itineraries JSONB 內含 base64 圖會超過 Nest 預設大小。

3. **`JwtStrategy` 的雙抽取**  
   cookie 優先、Bearer header 次之（給 supertest/curl 用）。位於 `auth/jwt.strategy.ts` 的 `cookieOrBearerExtractor`。

4. **AdminGuard 區分「沒帶 token」與「token 無效」**  
   passport-jwt 的 `info` 物件中，沒帶 token 時 `info.message === 'No auth token'`。Guard 對此分別丟 `請先登入` / `Invalid or expired token`，與舊版完全一致。

5. **HttpExceptionFilter 對 ZodError 與 ThrottlerException 的特殊處理**  
   不只是 HttpException 的子類別 — `ZodError` 額外帶 `issues`、`ThrottlerException` 訊息中文化為「太多請求，請稍候再試」。

6. **`HttpError` 的 response body shape**  
   故意把 `{ error, details? }` 放進 HttpException 的 response 物件。Filter 透過 `getResponse()` 取出原樣回，不要加 `error: exception.message` 等錯誤 fallback（會回成「Http Exception」）。

7. **Decimal 序列化**  
   `expenses.service.ts` 的 `toString()` / `parseNumeric()` 一定要沿用，否則 Prisma 會把 Decimal 變 string，破壞 API 的 number 契約。

8. **獨立 worker entry 的 ConfigModule**  
   `workers/reminder.entry.ts` 必須載入 `AppConfigModule + PrismaModule + RedisModule + ReminderModule.forWorker()`，否則 env 沒讀到、Prisma 沒連、BullMQ 沒連。

9. **`ReminderModule` 是 @Global**  
   讓 `TripsModule` / `TodosModule` 不必各自 import。改 `forApi/forWorker` 結構時要保留 `global: true`。

10. **限流訊息中文化在 `HttpExceptionFilter`**  
    沒走 ThrottlerGuard 的 `errorMessage` 自訂，而是在 filter 統一攔 `ThrottlerException` 改寫，避免散落各處。

## 2.9 遷移驗證方式

```bash
# 1. typecheck 全綠
npm run typecheck -w @trip-planner/api

# 2. e2e tests 全綠
npm test -w @trip-planner/api
# 預期：Test Files 3 passed, Tests 7 passed
#   - health.e2e-spec.ts  ← /health 煙霧測試
#   - auth.e2e-spec.ts    ← login/me/logout + 401 + 中文錯誤
#   - trips.e2e-spec.ts   ← list / 401 / delete + cancel reminders

# 3. dev server 啟動
docker compose up -d
npm run db:migrate -w @trip-planner/api
npm run db:seed -w @trip-planner/api
npm run dev
# 預期：API stdout 看到所有 RoutesResolver / RouterExplorer log，
#       Bootstrap 印出 listening 訊息

# 4. 對外契約驗證（瀏覽器）
# - 走完登入 → 列行程 → 編輯 → 加待辦設提醒 → 登出
# - cookie 行為、JSON shape、CORS 全部與遷移前一致
```

完整驗證見 [`docs/VERIFICATION.md`](VERIFICATION.md)。

## 2.10 已知遺留工作（非阻塞）

以下不影響功能，但建議排入後續 sprint：

- **e2e 測試覆蓋**：目前只有 health/auth/trips 三個 spec。其餘 6 個 controller（admin-users、participants、expenses、todos、homepage、weather、uploads）建議照 `trips.e2e-spec.ts` 樣板補齊。每個 ~50-80 行。
- **`turbo.json` env 清單**：`ENABLE_EMBEDDED_WORKER` 還沒登記到 `globalEnv`。如果你透過 Turbo 跑且該變數會影響 build cache hash，要加進去。
- **OpenAPI / Swagger**：Nest.js 有 `@nestjs/swagger` 可從 controller + zod schema 自動生成 spec，未來想替 `packages/api-client` 切換到 codegen 時可啟用。
- **Logger interceptor**：目前用 Nest 預設 logger，舊版 `morgan('dev'/'combined')` 仍在 main.ts 註冊。可考慮用 `LoggerInterceptor` + structured logging 取代。

## 2.11 Rollback

如果 Nest.js 版上線後發現嚴重 bug：

```bash
git revert <merge-commit-sha>      # 或 git checkout <pre-migration-tag>
npm install
npm run build -w @trip-planner/api
NODE_ENV=production npm run start -w @trip-planner/api
```

**前端與 packages 不需要改**（對外契約零變更），rollback 是單向的。
