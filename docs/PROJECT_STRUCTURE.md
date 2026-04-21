# Trip Planner Monorepo 完整結構導覽

## 🌳 最頂層

```
trip-planner/
├── apps/                  ← 「會跑起來」的應用程式（前端 + 後端）
├── packages/              ← 跨 app 共用的程式庫（前後端都 import）
├── docs/                  ← 人類看的文件
├── docker-compose.yml     ← 本地開發起 PG/Redis/MinIO 用
├── package.json           ← npm workspaces 主檔，定義「apps/* + packages/*」是子 workspace
├── turbo.json             ← Turborepo 任務編排（dev/build/test 的 pipeline 與快取規則）
├── tsconfig.base.json     ← 所有子專案 extends 的 TS 共用設定
└── prettier.config.cjs    ← 統一程式碼格式
```

> **心法**：`apps/` 是「終端產品」，`packages/` 是「組件庫」。`apps` 可以 import `packages`，反之不行。

---

## 🖥️ `apps/` — 兩個獨立部署的程式

### `apps/api/` — Express 5 後端

```
apps/api/
├── package.json          ← 後端依賴（Prisma、Express、BullMQ、ioredis、bcrypt…）
├── tsconfig.json
├── prisma/               ← Prisma 的家
│   ├── schema.prisma     ← 資料表 DSL（@map 對到 snake_case 欄位）
│   ├── sql/check_constraints.sql ← Prisma DSL 表達不了的 CHECK
│   └── migrations/       ← prisma migrate 自動產生的 SQL 版本控制
├── scripts/              ← 一次性 / 維運用 CLI
│   ├── applyCheckConstraints.ts  ← db:migrate 後跑，套 CHECK
│   └── reseedReminders.ts        ← 把 DB 裡 pending 的提醒重新塞回 BullMQ
└── src/                  ← 真正的後端程式
    ├── server.ts         ← 入口：listen port + graceful shutdown
    ├── app.ts            ← Express app 組裝（middleware + 掛 router）
    ├── config/env.ts     ← Zod 驗 process.env，啟動時失敗 fail-fast
    ├── db/
    │   ├── client.ts     ← Prisma singleton（dev 快取 globalThis）
    │   └── seed.ts       ← 種第一個 admin（npm run db:seed）
    ├── cache/redis.ts    ← ioredis client 單例
    ├── queue/
    │   ├── connection.ts        ← BullMQ 用的 ioredis 連線（與 cache 分開）
    │   ├── reminderQueue.ts     ← Queue 定義 + Worker 處理函式（寄信）
    │   └── reminderWorker.ts    ← 獨立 process 跑 worker 用的 entry
    ├── routes/           ← HTTP 路由層：解析 req → 呼叫 service → 回 res
    │   ├── auth.ts              POST /api/auth/login, /logout, GET /me
    │   ├── trips.ts             /api/trips CRUD
    │   ├── todos.ts             /api/trips/:id/todos PATCH（含 RMW）
    │   ├── participants.ts      /api/participants
    │   ├── expenses.ts          /api/expenses
    │   ├── adminUsers.ts        /api/admin-users（管理員管管理員）
    │   ├── homepage.ts          /api/homepage-settings/:key
    │   ├── uploads.ts           /api/uploads/cover（簽 MinIO presign URL）
    │   └── weather.ts           /api/weather, /weather/geocode（Redis cache proxy）
    ├── services/         ← 商業邏輯層：跟 Prisma / Redis / 第三方 API 互動
    │   ├── auth.ts              密碼 hash、JWT 簽發/驗證、撤銷
    │   ├── trips.ts             含 patchTripTodos 的 SELECT FOR UPDATE
    │   ├── expenses.ts          createExpenseWithSplits 用 $transaction
    │   ├── participants.ts      含 isParticipantInLedger 阻擋刪除
    │   ├── todos.ts             upsert + enqueueReminder
    │   └── weather.ts           OpenWeather + Redis 快取
    ├── middleware/       ← Express 攔截器
    │   ├── errorHandler.ts      把 throw 的 HttpError 轉成 JSON
    │   ├── requireAdmin.ts      驗 cookie JWT，掛上 req.admin
    │   ├── validate.ts          用 Zod schema 驗 body/query/params
    │   └── rateLimit.ts         登入端點的 5 次失敗限流
    ├── storage/s3.ts     ← AWS SDK 包裝，產 MinIO presigned URL
    └── utils/
        ├── asyncHandler.ts      包 async route，把 reject 丟到 errorHandler
        └── httpError.ts         HttpError.notFound/badRequest/conflict… 工廠
```

> **後端心法（分層）**：`routes` 只管「翻譯 HTTP ↔ 物件」，`services` 才有商業規則，`middleware` 處理橫切關注點（auth、限流、驗證、錯誤）。**永遠不要在 routes 直接呼叫 prisma**——透過 service。

### `apps/web/` — Vite + React SPA 前端

```
apps/web/
├── package.json         ← 前端依賴（React 18、shadcn/ui、React Query、Tailwind…）
├── index.html           ← Vite entry HTML
├── vite.config.ts       ← /api/* proxy 到 localhost:3000
├── tailwind.config.ts / postcss.config.js  ← Tailwind 設定
├── components.json      ← shadcn/ui CLI 配置（去哪生 UI 元件）
├── playwright.config.ts ← E2E 測試設定
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
    │   ├── admin/              管理後台用：HomepageManagement, TripEditor,
    │   │                        TripExpensesPanel, AccountManagement, ItineraryMap…
    │   ├── trip/               行程詳情頁的子元件：AddExpenseModal,
    │   │                        ExpenseLedgerModal, LuggageModal, ManageParticipants…
    │   └── ui/                 shadcn/ui 自動生成的 primitive（button、dialog、card…）
    ├── lib/             ← 純 JS/TS 邏輯（無 React）
    │   ├── apiClient.ts        建立 api-client 單例，注入 baseUrl
    │   ├── auth.ts             登入流程的 wrapper（call api、回傳 legacy shape）
    │   ├── trips.ts            前端對 trip 操作的 helper
    │   ├── expenses.ts         分帳計算
    │   ├── settlement.ts       多人結帳「誰該還誰」演算法
    │   ├── hotels.ts           飯店資料 helper（含 .test.ts 同檔測試）
    │   ├── googleMaps.ts       Google Maps SDK 載入
    │   ├── weather.ts          weather UI 工具 + localStorage 快取
    │   ├── siteName.ts         讀 homepage_settings.site_name
    │   ├── todoReminders.ts    todo 提醒時間計算
    │   ├── dayColors.ts        每日行程的顏色生成
    │   ├── utils.ts            cn() 等共用工具
    │   └── supabase.ts         「Throw on access」的 Proxy shim（防回頭依賴）
    ├── hooks/           ← React custom hooks
    │   ├── use-mobile.tsx, use-toast.ts        ← shadcn 內建
    │   ├── useSiteDisplayTitle.ts              ← 讀網站名稱
    │   └── useSyncDocumentTitle.ts             ← 同步 document.title
    ├── data/mockData.ts ← 本地 fallback / dev seed 資料
    ├── types/           ← 純 re-export shared-types 的薄層（歷史遺留）
    │   ├── trip.ts             export * from '@trip-planner/shared-types'
    │   └── expense.ts          同上
    └── test/            ← Vitest 設定
        ├── setup.ts
        └── example.test.ts
```

> **前端心法**：`pages` 是路由節點 → `components` 組裝 UI → `lib` 處理純邏輯 → `apiClient` 對外通訊。React state/effect 只放在 `pages`/`components`/`hooks`，`lib/` 永遠不 import React。

---

## 📦 `packages/` — 前後端共用「合約」

```
packages/
├── shared-types/        ← 純 TS 介面（DTO 名詞）
│   └── src/
│       ├── trip.ts             Trip, TodoItem, FlightInfo…
│       ├── expense.ts          Expense, ExpenseWithSplits, TripParticipant…
│       ├── auth.ts             AdminUser, LoginResponse
│       ├── weather.ts          WeatherBundle, GeoCityHit
│       ├── homepage.ts         HomepageSettingEntry
│       ├── row-mappers.ts      TripRow（snake_case）+ rowToTrip 等翻譯
│       └── index.ts            re-export 全部
├── shared-schema/       ← Zod schema（驗證規則）
│   └── src/
│       ├── trip.ts             createTripSchema, updateTripSchema…
│       ├── expense.ts, auth.ts, weather.ts, todo.ts, homepage.ts
│       └── index.ts
└── api-client/          ← 前端用的 typed fetch wrapper
    └── src/
        ├── client.ts           ApiClient interface + createApiClient()
        └── index.ts            re-export
```

> **packages 心法**：這層是**前後端 HTTP 邊界的共同語言**。後端 `services` 回傳 `shared-types` 的型別 → JSON 過網路 → 前端 `api-client` 接收同型別。改一邊就會在編譯期推到另一邊。

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
├── MIGRATION.md      從舊 Supabase 專案搬資料的步驟（schema、data、storage、提醒重排）
└── VERIFICATION.md   上線前驗證 checklist（docker / DB / dev server / 端到端 / smoke）
```

---

## 🐳 根目錄基礎設施

| 檔案 | 用途 |
|---|---|
| `docker-compose.yml` | 本地起 Postgres 16、Redis 7、MinIO（含自動建 bucket 的 init container） |
| `package.json` (root) | 宣告 `workspaces: ["apps/*", "packages/*"]`、dev/build/lint 的根 script |
| `turbo.json` | 定義 `dev`、`build`、`test`、`lint`、`typecheck` 的依賴關係與快取輸出 |
| `tsconfig.base.json` | 所有子 tsconfig extends 的共用 compilerOptions（strict、target、module…） |
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
    │ 參數型別：CreateExpensePayload (來自 packages/shared-types)
    ▼ ============= HTTP =============
[apps/api/src/routes/expenses.ts]                    ← Express handler
    │ ① middleware/validate.ts 用 packages/shared-schema 驗 body
    │ ② middleware/requireAdmin.ts 驗 JWT cookie
    ▼
[apps/api/src/services/expenses.ts] createExpenseWithSplits(...)
    │ prisma.$transaction → expense.create + expenseSplit.createMany
    ▼
[apps/api/src/db/client.ts] prisma singleton
    │
    ▼ ============= SQL =============
[Postgres @ docker-compose]
    │ schema 由 [apps/api/prisma/schema.prisma] 定義
    │ CHECK constraint 由 [apps/api/prisma/sql/check_constraints.sql] 套用
    ▼
回傳 ExpenseWithSplits（packages/shared-types 型別）→ JSON → 前端 React Query 更新 UI
```

---

## 🧠 速記表：哪一層做什麼

| 想做這件事 | 去這個資料夾 |
|---|---|
| 新增 API endpoint | `apps/api/src/routes/` + `services/` |
| 改 DB schema | `apps/api/prisma/schema.prisma` → `npm run db:generate` |
| 改 API 回傳型別 | `packages/shared-types/src/` |
| 改 API 驗證規則 | `packages/shared-schema/src/` |
| 加新頁面 | `apps/web/src/pages/` + 註冊到 `App.tsx` |
| 加 UI 元件 | `apps/web/src/components/`（shadcn primitive 在 `ui/`） |
| 加純邏輯 helper | `apps/web/src/lib/`（前端）或 `apps/api/src/utils/`（後端） |
| 改寄信邏輯 | `apps/api/src/queue/reminderQueue.ts` |
| 加環境變數 | `apps/api/src/config/env.ts` + `.env.example` |
| 文件 | `docs/` 或各 app 自己的 `README.md` |
