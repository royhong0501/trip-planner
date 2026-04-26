# Trip Planner Monorepo 完整結構導覽

> **最後更新**：2026-04-26（Express 5 → Nest.js 10 遷移完成）

這份文件是「從不認識這個 repo」開始建立心智模型的入口。看完應該知道：每一行程式碼為什麼放在這裡、改某件事該動哪裡、一個請求是怎麼穿過所有層。

---

## 🌳 最頂層

```
trip-planner/
├── apps/                  ← 「會跑起來」的應用程式（前端 + 後端）
├── packages/              ← 跨 app 共用的程式庫（前後端都 import）
├── docs/                  ← 人類看的文件（你正在讀的就在這）
├── docker-compose.yml     ← 本地起 Postgres / Redis / MinIO 用
├── package.json           ← npm workspaces 主檔，宣告 apps/* + packages/* 是子 workspace
├── turbo.json             ← Turborepo 任務編排（dev/build/test 的 pipeline 與快取規則）
├── tsconfig.base.json     ← 所有子 tsconfig 的共用基底（strict、ES2022、NodeNext）
└── prettier.config.cjs    ← 統一程式碼格式
```

> **心法**：`apps/` 是「終端產品」，`packages/` 是「組件庫」。`apps` 可以 import `packages`，反之不行。

---

## 🖥️ `apps/` — 兩個獨立部署的程式

### `apps/api/` — Nest.js 10 後端

> **2026-04 框架重構**：原本是手刻的 Express 5（routes/services/middleware 三層）。已全面改為 Nest.js，採用 feature-based module + 依賴注入。對外 HTTP 契約零變更（路徑、JSON shape、cookie 名稱、錯誤格式都保留），所以 `apps/web` 與 `packages/api-client` 不需要動。

```
apps/api/
├── package.json              ← 後端依賴（@nestjs/*、prisma、bullmq、ioredis、bcrypt…）
├── tsconfig.json             ← experimentalDecorators + emitDecoratorMetadata 啟用
├── nest-cli.json             ← （不存在；本專案直接用 tsx + tsc，跳過 nest CLI）
├── vitest.config.ts          ← e2e 測試設定（unplugin-swc 解 decorator metadata）
├── prisma/                   ← Prisma 的家
│   ├── schema.prisma         ← 8 個 model：Trip / TripParticipant / Expense / ExpenseSplit /
│   │                            Todo / HomepageSetting / EmailJobLog / AdminUser
│   ├── sql/check_constraints.sql  ← Prisma DSL 表達不了的 CHECK（enum、非空、非負）
│   └── migrations/           ← prisma migrate 自動產生的 SQL 版本
├── scripts/                  ← 一次性 / 維運 CLI（透過 tsx 跑，不參與 main build）
│   ├── tsconfig.json         ← scripts 自己的 TS 設定（rootDir=.）
│   ├── applyCheckConstraints.ts  ← db:migrate 後跑，套 prisma/sql/check_constraints.sql
│   └── reseedReminders.ts        ← 把 DB 裡 pending 的提醒重塞回 BullMQ
├── test/                     ← Nest.js TestingModule + supertest e2e
│   ├── setup.ts              ← 測試環境變數 stub（process.env.* 預設值）
│   ├── bootstrap.ts          ← 建立含全域 middleware 的測試 app
│   ├── auth.helper.ts        ← 產 admin JWT cookie / Bearer header
│   ├── health.e2e-spec.ts    ← /health 煙霧測試
│   ├── auth.e2e-spec.ts      ← login / me / logout 三條 happy path
│   └── trips.e2e-spec.ts     ← list / 401 / delete + cancel reminders
└── src/                      ← 真正的後端程式
    ├── main.ts               ← 入口（取代舊 server.ts）：
    │                            NestFactory.create + helmet/cors/cookieParser/compression
    │                            10mb body limit + global HttpExceptionFilter + shutdown hooks
    ├── app.module.ts         ← 根 Module：組合 13 個 feature module + ThrottlerModule
    │
    ├── common/               ← 跨模組基礎建設
    │   ├── exceptions/http.exception.ts
    │   │     └─ HttpError 繼承 HttpException，保留 .badRequest()/.notFound()/...
    │   │        靜態工廠（service 層程式碼幾乎不用改）。回應 body 為 { error, details? }。
    │   ├── filters/http-exception.filter.ts
    │   │     └─ 全域 ExceptionFilter，處理：
    │   │        - HttpError → 取 getResponse() 的 { error, details } 直送
    │   │        - ZodError → 400 { error: 'Invalid request payload', issues }
    │   │        - ThrottlerException → 429 { error: '太多請求，請稍候再試' }（中文化）
    │   │        - 其他 → 500（prod 隱藏 message）
    │   ├── pipes/zod-validation.pipe.ts
    │   │     └─ @Body(new ZodValidationPipe(createTripSchema)) 取代舊 validate middleware
    │   ├── guards/admin.guard.ts
    │   │     └─ passport-jwt 包裝。沒帶 token → 「請先登入」、其他 → 「Invalid or expired token」
    │   └── decorators/current-admin.decorator.ts
    │         └─ @CurrentAdmin() admin: AdminTokenPayload — 在 controller 拿 JWT payload
    │
    ├── config/
    │   ├── env.schema.ts     ← zod envSchema + parseEnv() — 啟動時 fail-fast
    │   └── config.module.ts  ← @Global，提供 APP_CONFIG token（值為 parseEnv() 結果）
    │
    ├── modules/              ← 功能模組（feature-based 拆分，13 個）
    │   ├── prisma/                   ← @Global
    │   │   ├── prisma.service.ts     ← extends PrismaClient，OnModuleInit/Destroy
    │   │   └── prisma.module.ts
    │   │
    │   ├── redis/                    ← @Global
    │   │   ├── redis.constants.ts    ← REDIS_CLIENT, BULL_CONNECTION 兩個 token
    │   │   ├── redis.service.ts      ← readJson/writeJson 包 ioredis
    │   │   └── redis.module.ts       ← OnApplicationShutdown 自動 quit
    │   │
    │   ├── auth/
    │   │   ├── auth.service.ts       ← bcrypt + JWT sign/verify + Redis revoked_jti
    │   │   ├── auth.controller.ts    ← POST /api/auth/login (＋@Throttle), /logout, GET /me
    │   │   ├── jwt.strategy.ts       ← passport-jwt，從 cookie 或 Authorization header 抽 token
    │   │   └── auth.module.ts        ← imports PassportModule，exports AuthService
    │   │
    │   ├── admin-users/              ← /api/admin/users CRUD（依賴 AuthModule 的 hashPassword）
    │   │
    │   ├── trips/                    ← /api/trips
    │   │   ├── trips.service.ts      ← CRUD + patchTodos（含 SELECT ... FOR UPDATE）
    │   │   │                            applyTodoOp() 純函式留在這支
    │   │   ├── trips.controller.ts   ← 注入 ReminderQueueService 做 deleteTrip 的 cascade cancel
    │   │   └── trips.module.ts
    │   │
    │   ├── todos/                    ← /api/trips/:tripId/todos PATCH/POST 與 /api/todos/:id DELETE
    │   │   ├── todos.service.ts      ← upsertReminder：寫 todo row + enqueue BullMQ
    │   │   ├── todos.controller.ts   ← imports TripsModule（要呼叫 patchTodos）
    │   │   └── todos.module.ts
    │   │
    │   ├── participants/             ← /api/trips/:tripId/participants + /api/participants/:id
    │   │                                含 isInLedger() 阻擋刪除（在 ledger 中的成員）
    │   │
    │   ├── expenses/                 ← /api/trips/:tripId/expenses + /api/expenses
    │   │                                createWithSplits 用 prisma.$transaction
    │   │                                Decimal 透過 toString()/parseNumeric() 序列化
    │   │
    │   ├── homepage/                 ← /api/homepage-settings/:key（GET 公開 / PATCH admin）
    │   │
    │   ├── weather/                  ← /api/weather + /api/weather/geocode
    │   │                                使用 ThrottlerGuard + @Throttle 取代外部 proxy 限流
    │   │                                注入 RedisService 做 30min/24h 快取
    │   │
    │   ├── uploads/                  ← /api/uploads/cover
    │   │   ├── s3.service.ts         ← S3Client + bucket + publicBaseUrl 包裝
    │   │   └── uploads.controller.ts ← 產 presigned PUT URL + public URL
    │   │
    │   ├── reminder/                 ← @Global，@nestjs/bullmq
    │   │   ├── reminder.constants.ts ← REMINDER_QUEUE_NAME = 'trip-reminders'，jobId 規則
    │   │   ├── reminder.queue.service.ts ← enqueue / cancel / cancelAllForTrip
    │   │   ├── reminder.processor.ts ← @Processor('trip-reminders')
    │   │   │                            載入 todo → 寄 Brevo email → 寫 email_job_logs
    │   │   └── reminder.module.ts    ← forApi({embedded}) / forWorker() 兩種啟用
    │   │
    │   └── health/                   ← GET /health
    │
    ├── workers/
    │   └── reminder.entry.ts         ← NestFactory.createApplicationContext(WorkerModule)
    │                                    供 `npm run worker:reminder` 啟用獨立行程
    │
    └── db/
        └── seed.ts                   ← 種第一個 admin（讀 ADMIN_SEED_EMAIL/PASSWORD）
                                         直接 new PrismaClient()，不依賴 Nest module
```

#### Nest.js 後端心法

1. **route → controller、service → @Injectable() class、middleware → guard/pipe/filter**。
   別在 controller 直接呼叫 prisma — 一律走 service。
2. **@Global() 的範圍**：`PrismaModule`、`RedisModule`、`ReminderModule`、`AppConfigModule`。其他 feature module 不必再 import。
3. **驗證唯一管道**：`@Body / @Query / @Param + new ZodValidationPipe(schema)`，schema 必來自 `packages/shared-schema`。**不要手寫 Express middleware**。
4. **錯誤統一語意**：service 層 `throw HttpError.notFound(...)` / `HttpError.conflict(...)` 等等，全部會被 `HttpExceptionFilter` 包成 `{ error, details? }`。
5. **生命週期**：app shutdown → `enableShutdownHooks()` 觸發 PrismaService.onModuleDestroy + RedisModule.onApplicationShutdown，自動關連線。

#### 17 條 HTTP 端點 ↔ Controller 對照

| 方法 | 路徑 | Controller | Guards |
|---|---|---|---|
| POST | `/api/auth/login` | `AuthController.login` | Throttle (20/15min) |
| POST | `/api/auth/logout` | `AuthController.logout` | — |
| GET | `/api/auth/me` | `AuthController.me` | AdminGuard |
| GET | `/api/admin/users` | `AdminUsersController.list` | AdminGuard |
| POST | `/api/admin/users` | `AdminUsersController.create` | AdminGuard |
| PATCH | `/api/admin/users/:userId/password` | `AdminUsersController.updatePassword` | AdminGuard |
| DELETE | `/api/admin/users/:userId` | `AdminUsersController.delete` | AdminGuard |
| GET | `/api/trips` | `TripsController.list` | — |
| GET | `/api/trips/:id` | `TripsController.getById` | — |
| POST | `/api/trips` | `TripsController.create` | AdminGuard |
| PATCH | `/api/trips/:id` | `TripsController.update` | AdminGuard |
| PATCH | `/api/trips/:id/lists` | `TripsController.updateLists` | AdminGuard |
| DELETE | `/api/trips/:id` | `TripsController.delete` | AdminGuard |
| PATCH | `/api/trips/:tripId/todos` | `TodosController.patch` | AdminGuard |
| POST | `/api/trips/:tripId/todos` | `TodosController.addReminder` | AdminGuard |
| DELETE | `/api/todos/:id` | `TodosController.deleteReminder` | AdminGuard |
| GET | `/api/trips/:tripId/participants` | `ParticipantsController.list` | — |
| POST | `/api/trips/:tripId/participants` | `ParticipantsController.add` | AdminGuard |
| DELETE | `/api/participants/:id` | `ParticipantsController.delete` | AdminGuard |
| GET | `/api/trips/:tripId/expenses` | `ExpensesController.list` | — |
| POST | `/api/expenses` | `ExpensesController.create` | AdminGuard |
| PATCH | `/api/expenses/:id` | `ExpensesController.update` | AdminGuard |
| DELETE | `/api/expenses/:id` | `ExpensesController.delete` | AdminGuard |
| GET | `/api/homepage-settings/:key` | `HomepageController.get` | — |
| PATCH | `/api/homepage-settings/:key` | `HomepageController.upsert` | AdminGuard |
| GET | `/api/weather` | `WeatherController.get` | Throttler (60/min) |
| GET | `/api/weather/geocode` | `WeatherController.geocode` | Throttler (60/min) |
| POST | `/api/uploads/cover` | `UploadsController.coverPresign` | AdminGuard |
| GET | `/health` | `HealthController.check` | — |

> **GET 公開**：trips list/detail、participants list、expenses list、homepage settings、health。  
> **AdminGuard**：所有寫操作 + admin-users 整組 + `/api/auth/me`。  
> **Throttler**：login（防爆破）、weather（防外部 API 配額爆掉）。

---

### `apps/web/` — Vite + React SPA 前端

```
apps/web/
├── package.json         ← 前端依賴（React 18、shadcn/ui、React Query、Tailwind…）
├── index.html           ← Vite entry HTML
├── vite.config.ts       ← /api/* proxy 到 localhost:3000（dev）
├── tailwind.config.ts / postcss.config.js  ← Tailwind 設定
├── components.json      ← shadcn/ui CLI 配置
├── playwright.config.ts ← E2E 測試設定（Playwright）
├── public/              ← 靜態資源（直接複製到 dist/）
└── src/
    ├── main.tsx         ← React 掛載點
    ├── App.tsx          ← 路由表 + Provider 包裹
    ├── pages/           ← 一頁一檔（react-router 的 route element）
    │   ├── Index.tsx           首頁
    │   ├── TripDetail.tsx      行程詳情
    │   ├── AdminLogin.tsx      後台登入
    │   ├── AdminDashboard.tsx  後台主頁
    │   └── NotFound.tsx        404
    ├── components/      ← 可重用 UI 元件（按領域分子資料夾）
    │   ├── Header.tsx, HeroCarousel.tsx, TripCard.tsx, …  ← 首頁區塊
    │   ├── admin/              管理後台（HomepageManagement, TripEditor, …）
    │   ├── trip/               行程詳情頁子元件（AddExpenseModal, ExpenseLedgerModal, …）
    │   └── ui/                 shadcn/ui 自動生成的 primitive
    ├── lib/             ← 純 JS/TS 邏輯（無 React）
    │   ├── apiClient.ts        建立 api-client 單例，注入 baseUrl
    │   ├── auth.ts             登入流程的 wrapper
    │   ├── trips.ts            前端 trip 操作 helper
    │   ├── expenses.ts / settlement.ts  ← 分帳計算
    │   ├── hotels.ts / googleMaps.ts / weather.ts / siteName.ts / todoReminders.ts
    │   ├── dayColors.ts        每日行程顏色生成
    │   ├── utils.ts            cn() 等共用工具
    │   └── supabase.ts         「Throw on access」的 Proxy shim（防回頭依賴）
    ├── hooks/           ← React custom hooks
    ├── data/mockData.ts ← 本地 fallback / dev seed 資料
    ├── types/           ← 純 re-export shared-types 的薄層
    └── test/            ← Vitest 設定（jsdom 環境）
```

> **前端心法**：`pages` 是路由節點 → `components` 組裝 UI → `lib` 處理純邏輯 → `apiClient` 對外通訊。React state/effect 只放在 `pages`/`components`/`hooks`，`lib/` 永遠不 import React。

---

## 📦 `packages/` — 前後端共用「合約」

```
packages/
├── shared-types/        ← 純 TS 介面（DTO 名詞）
│   └── src/
│       ├── trip.ts             Trip, TodoItem, FlightInfo, DailyItinerary, …
│       ├── expense.ts          Expense, ExpenseWithSplits, TripParticipant, …
│       ├── auth.ts             AdminUser, LoginResponse, AuthSession
│       ├── weather.ts          WeatherBundle, GeoCityHit, ForecastHourItem
│       ├── homepage.ts         HomepageSettingEntry, CarouselSlide
│       ├── row-mappers.ts      TripRow（snake_case）↔ Trip（camelCase）翻譯
│       │                       含 rowToTrip / tripToRow / parseNumeric
│       └── index.ts            re-export 全部
├── shared-schema/       ← Zod schema（驗證規則）— Nest.js 用 createZodDto 包成 DTO
│   └── src/
│       ├── trip.ts             createTripSchema, updateTripSchema, tripSchema
│       ├── expense.ts          createExpenseSchema, updateExpenseSchema
│       ├── auth.ts             loginSchema, createAdminUserSchema, updateAdminUserPasswordSchema
│       ├── weather.ts          weatherQuerySchema, geocodeQuerySchema
│       ├── todo.ts             patchTodosSchema (op | replace)
│       ├── homepage.ts         presignUploadSchema
│       └── index.ts
└── api-client/          ← 前端用的 typed fetch wrapper
    └── src/
        ├── client.ts           ApiClient interface (27 methods) + createApiClient()
        └── index.ts            re-export
```

> **packages 心法**：這層是**前後端 HTTP 邊界的共同語言**。後端 controller 回傳 `shared-types` 的型別 → JSON 過網路 → 前端 `api-client` 接收同型別。改一邊就會在編譯期推到另一邊。
>
> Nest.js 遷移時這三個 package 完全沒動。`shared-schema` 的 zod schemas 直接被 `ZodValidationPipe(schema)` 套用；`shared-types` 的 row mapper 在每個 service 裡照舊使用。

### 三個 package 的精準定位

| Package | 角色 | 比喻 |
|---|---|---|
| `shared-types` | **DTO**（資料形狀） | 名詞 |
| `shared-schema` | **Validator**（這個形狀對不對） | 規則 |
| `api-client` | **Client**（怎麼把這個形狀送過去 / 拿回來） | 動詞 |

---

## 📚 `docs/` — 給人讀的維運文件

```
docs/
├── PROJECT_STRUCTURE.md   你正在讀的這份
├── MIGRATION.md           兩段式遷移：Supabase→自架 PG、Express→Nest.js
└── VERIFICATION.md        上線前驗證 checklist
```

---

## 🐳 根目錄基礎設施

| 檔案 | 用途 |
|---|---|
| `docker-compose.yml` | 本地起 Postgres 16、Redis 7、MinIO + 自動建 bucket 的 init container |
| `package.json` (root) | 宣告 `workspaces: ["apps/*", "packages/*"]`、根 script |
| `turbo.json` | 定義 `dev`、`build`、`test`、`lint`、`typecheck` 的依賴關係與快取輸出 |
| `tsconfig.base.json` | 所有子 tsconfig extends 的共用 compilerOptions（strict、ES2022） |
| `.env.example` | env 範本，含 `ENABLE_EMBEDDED_WORKER`（Nest.js 新增）等所有變數 |
| `prettier.config.cjs` | 統一格式 |

---

## 🔄 一個請求穿越整個系統的路徑

以「使用者新增一筆花費」為例，看資料夾怎麼串起來：

```
[apps/web/src/components/trip/AddExpenseModal.tsx]   ← 表單元件
    │ 收集輸入
    ▼
[apps/web/src/lib/expenses.ts]                       ← 計算分帳
    │
    ▼
[packages/api-client/src/client.ts] api.createExpense(payload, splits)
    │ 參數型別：CreateExpensePayload, CreateExpenseSplitPayload[] (來自 packages/shared-types)
    ▼ ============= HTTP =============
[apps/api/src/modules/expenses/expenses.controller.ts]
    │ ① ZodValidationPipe(createExpenseSchema) 驗 body — schema 來自 shared-schema
    │ ② AdminGuard → JwtStrategy → @CurrentAdmin() 取 token payload
    ▼
[apps/api/src/modules/expenses/expenses.service.ts] createWithSplits(payload, splits)
    │ this.prisma.$transaction(async tx => { 
    │   tx.expense.create(...) + tx.expenseSplit.createMany(...)
    │ })
    ▼
[apps/api/src/modules/prisma/prisma.service.ts] PrismaService（@Global）
    │
    ▼ ============= SQL =============
[Postgres @ docker-compose]
    │ schema 由 [apps/api/prisma/schema.prisma] 定義
    │ CHECK constraint 由 [apps/api/prisma/sql/check_constraints.sql] 套用
    ▼
回傳 ExpenseWithSplits（packages/shared-types 型別） 
    │ ← controller 直接 return service 結果
    ▼
[HttpExceptionFilter / 預設 serializer] 序列化成 JSON
    ▼
前端 React Query 接到 → 更新快取 → 元件重新 render
```

對照下游錯誤路徑：

```
service throw HttpError.conflict('此成員仍有花費或分攤紀錄，無法刪除')
    │
    ▼
[apps/api/src/common/filters/http-exception.filter.ts]
    │ instanceof HttpError → res.status(409).json({ error: '...' })
    ▼
ApiClient fetch 收到 res.status >= 400 → throw → React Query onError → toast
```

---

## 🧠 速記表：哪一層做什麼

| 想做這件事 | 去這個資料夾 |
|---|---|
| 新增 API endpoint | `apps/api/src/modules/<feature>/<feature>.controller.ts` + `.service.ts` |
| 新增 feature module | `apps/api/src/modules/<feature>/` 並在 `app.module.ts` imports 加入 |
| 改 DB schema | `apps/api/prisma/schema.prisma` → `npm run db:generate -w @trip-planner/api` |
| 改 API 回傳型別 | `packages/shared-types/src/` |
| 改 API 驗證規則 | `packages/shared-schema/src/` |
| 加新頁面 | `apps/web/src/pages/` + 註冊到 `App.tsx` |
| 加 UI 元件 | `apps/web/src/components/`（shadcn primitive 在 `ui/`） |
| 加純邏輯 helper（前端） | `apps/web/src/lib/` |
| 改寄信 / 提醒邏輯 | `apps/api/src/modules/reminder/reminder.processor.ts` |
| 改提醒佇列介面 | `apps/api/src/modules/reminder/reminder.queue.service.ts` |
| 加環境變數 | `apps/api/src/config/env.schema.ts` 的 zod schema + `.env.example` |
| 加全域中介層 / Filter | `apps/api/src/common/` 並到 `main.ts` 註冊 |
| 加 Guard 規則 | `apps/api/src/common/guards/` 並到 controller 用 `@UseGuards` |
| 加 e2e 測試 | `apps/api/test/<feature>.e2e-spec.ts`（參考 `trips.e2e-spec.ts` 樣板） |
| 文件 | `docs/` 或各 app 自己的 `README.md` |

---

## 🎓 Nest.js 遷移與舊 Express 結構的對照

| 舊（Express） | 新（Nest.js） | 備註 |
|---|---|---|
| `src/server.ts` | `src/main.ts` | NestFactory.create + global middleware |
| `src/app.ts createApp()` | `src/app.module.ts AppModule` | 所有 feature module 在這裡組合 |
| `src/routes/<feature>.ts` | `src/modules/<feature>/<feature>.controller.ts` | `@Controller('api/...')` + `@Get/@Post/...` |
| `src/services/<feature>.ts` | `src/modules/<feature>/<feature>.service.ts` | `@Injectable()` class，prisma 注入而非 import |
| `src/middleware/validate.ts` | `src/common/pipes/zod-validation.pipe.ts` | `@Body(new ZodValidationPipe(schema))` |
| `src/middleware/requireAdmin.ts` | `src/common/guards/admin.guard.ts` + `JwtStrategy` | `@UseGuards(AdminGuard)` |
| `src/middleware/errorHandler.ts` | `src/common/filters/http-exception.filter.ts` | 全域 `app.useGlobalFilters` |
| `src/middleware/rateLimit.ts` | `@nestjs/throttler` + `@Throttle` decorator | Redis 儲存沿用 |
| `src/utils/asyncHandler.ts` | （刪除） | Nest 預設處理 async |
| `src/utils/httpError.ts` | `src/common/exceptions/http.exception.ts` | 介面相同，內部繼承 HttpException |
| `src/db/client.ts` | `src/modules/prisma/prisma.service.ts` | `extends PrismaClient`，OnModuleInit/Destroy |
| `src/cache/redis.ts` | `src/modules/redis/redis.service.ts` + `REDIS_CLIENT` token | readJson/writeJson 變成 method |
| `src/queue/connection.ts` | `BULL_CONNECTION` provider in RedisModule | |
| `src/queue/reminderQueue.ts` (Queue+Worker) | `ReminderQueueService` + `ReminderProcessor` | `@nestjs/bullmq`，分離生產者/消費者 |
| `src/queue/reminderWorker.ts` | `src/workers/reminder.entry.ts` | `NestFactory.createApplicationContext` |
| `src/storage/s3.ts` | `src/modules/uploads/s3.service.ts` | 包成 @Injectable |
| `src/config/env.ts` | `src/config/env.schema.ts` + `config.module.ts` | parseEnv() 由 @Global module 提供 |
