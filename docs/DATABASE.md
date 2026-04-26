# 資料庫結構與設計邏輯

> **資料來源**：`apps/api/prisma/schema.prisma` + `apps/api/prisma/sql/check_constraints.sql`  
> **目標讀者**：要改 schema、寫複雜查詢、規劃容量、或 onboard 新後端工程師時讀這份。  
> **資料庫**：PostgreSQL 16（`docker-compose.yml` 定錨版本）。

這份文件分成五段：
1. **總覽與關聯圖** — 8 張表的全景
2. **每張表的詳細欄位 + 設計邏輯** — 每個欄位為什麼長這樣
3. **JSONB 欄位深度解析** — Trip 用了 7 個 JSONB，逐一拆解
4. **CHECK 約束、索引、外鍵策略** — Prisma DSL 表達不出來的部分
5. **慣例與設計原則** — 命名、型別、級聯、UUID 策略

---

## 1. 總覽與關聯圖

8 張表分成 4 個邏輯群組：

```
┌──────────────┐        ┌──────────────────┐       ┌──────────────────┐
│  admin_users │        │ homepage_settings│       │ email_job_logs   │
│  （後台帳號）│        │ （首頁 KV 設定） │       │ （提醒寄信稽核） │
└──────────────┘        └──────────────────┘       └──────────────────┘
     獨立                    獨立                        獨立

┌──────────────────────────── trips（行程主檔）─────────────────────────────┐
│     1                                                                     │
│     │                                                                     │
│     ▼ ON DELETE CASCADE                                                   │
│  ┌──────────────────┐                                                     │
│  │trip_participants │ ─────┐ payer (RESTRICT)                             │
│  │（成員：人/email）│      │                                              │
│  └──────────────────┘      │                                              │
│     │ N                    │                                              │
│     │ ON DELETE CASCADE    │                                              │
│     │                      ▼                                              │
│     │              ┌──────────────┐  1     N    ┌──────────────────┐     │
│     │              │   expenses   │ ──────────► │  expense_splits  │     │
│     │              │ （花費主檔） │  CASCADE    │   （分帳明細）   │     │
│     │              └──────────────┘             └──────────────────┘     │
│     │                                                  ▲ N               │
│     │ ON DELETE SET NULL                               │ CASCADE         │
│     ▼                                                  │ (參與者)        │
│  ┌──────────┐ assignedParticipant                      │                 │
│  │  todos   │ ───────────────────────────────────────────                │
│  │（提醒列）│                                                            │
│  │ FK → trip_participants ON DELETE SET NULL                             │
│  └──────────┘                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

關鍵點：
- **`trips` 是頂層 aggregate root**：所有行程相關資料（參與者、花費、提醒）刪除行程時級聯清除。
- **`payer` 用 RESTRICT**（不是 CASCADE）：避免不小心刪掉一名「曾付過款」的成員把整筆 expense 連根拔起。要刪這名成員必須先把他付過的 expense 砍乾淨。
- **`assignedParticipant` 用 SET NULL**：成員被刪除時，提醒不消失，只是失去指派對象（後續寄信會 fallback 到 `REMINDER_FALLBACK_EMAIL`）。

---

## 2. 每張表詳細欄位

### 2.1 `trips` — 行程主檔

```sql
CREATE TABLE trips (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT         NOT NULL DEFAULT '',
  cover_image         TEXT         NOT NULL DEFAULT '',
  start_date          TEXT         NOT NULL DEFAULT '',
  end_date            TEXT         NOT NULL DEFAULT '',
  category            TEXT         NOT NULL DEFAULT 'domestic',
  status              TEXT         NOT NULL DEFAULT 'planning',
  todos               JSONB        NOT NULL DEFAULT '[]',
  flights             JSONB        NOT NULL DEFAULT '{"departure":{},"return":{}}',
  hotels              JSONB        NOT NULL DEFAULT '[]',
  daily_itineraries   JSONB        NOT NULL DEFAULT '[]',
  luggage_list        JSONB        NOT NULL DEFAULT '[]',
  shopping_list       JSONB        NOT NULL DEFAULT '[]',
  other_notes         TEXT         NOT NULL DEFAULT '',
  weather_cities      JSONB        NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- CHECK trips_category_enum:  category IN ('domestic','international')
  -- CHECK trips_status_enum:    status   IN ('planning','ongoing','completed')
);
```

| 欄位 | 型別 | 預設 | 設計邏輯 |
|---|---|---|---|
| `id` | `UUID` | `gen_random_uuid()` | UUID 為什麼不用自增 INT？因前端建立行程時可以**先在 client 生 UUID**，網路斷線重送時 idempotent；也避免 enumeration attack（猜下一個 trip id）。`gen_random_uuid()` 由 `pgcrypto` extension 提供。 |
| `title` | `TEXT` | `''` | 為什麼預設空字串而不是 NOT NULL？因為前端是「先建立草稿、再慢慢填」的編輯模式，禁止空字串會讓建立流程要先彈表單。空字串在 UI 端顯示「（未命名行程）」。 |
| `cover_image` | `TEXT` | `''` | 存 S3 / MinIO 的 public URL（不是 base64）。空字串時前端 fallback 到 placeholder。 |
| `start_date` / `end_date` | `TEXT` | `''` | **故意用 TEXT 不用 DATE**：行程的「日期」是「使用者心中的當地日期」，不需要時區轉換；UI 端只比較字串就能排序（YYYY-MM-DD）。如果改成 `DATE`，跨時區用戶會看到日期偏移一天的奇怪情況。 |
| `category` | `TEXT` | `'domestic'` | 列舉值由 CHECK constraint `trips_category_enum` 限制（見 §4）。為什麼不用 PG ENUM 型別？因為 PG enum 加值要 `ALTER TYPE`，不能 backwards compatible drop；CHECK + TEXT 更彈性。 |
| `status` | `TEXT` | `'planning'` | 同上，限 `'planning' / 'ongoing' / 'completed'`。前端用 status 切顯示 tab。 |
| `todos` | `JSONB` | `'[]'` | **JSONB 而非獨立表**：todos 通常一個行程只有 ≤20 個，整批讀寫且**伴隨 `SELECT ... FOR UPDATE` 序列化更新**比拆表 join 簡單。詳見 §3.1。 |
| `flights` | `JSONB` | `'{"departure":{},"return":{}}'` | 預設物件而非 `{}`，是因為 UI 期望 `flights.departure.airline` 等欄位永遠存在（即使空字串）。Zod schema 也以這個 shape 驗證。 |
| `hotels` | `JSONB` | `'[]'` | 一行程多飯店，但通常 ≤3 筆，用 JSONB 陣列比建關聯表划算（不需 join）。 |
| `daily_itineraries` | `JSONB` | `'[]'` | **這是行程裡最大的欄位**：每日活動含座標、Google Place ID、筆記。極端情況可達 hundreds of KB（內嵌 base64 縮圖），所以列表 API（`GET /api/trips`）刻意不回這欄。詳見 §3.4。 |
| `luggage_list` | `JSONB` | `'[]'` | 行李清單分類列表。每分類一個 participantId（誰負責帶）。 |
| `shopping_list` | `JSONB` | `'[]'` | 採買清單，含 status (`incomplete`/`complete`)、price、participant。 |
| `other_notes` | `TEXT` | `''` | 自由文字筆記。 |
| `weather_cities` | `JSONB` | `'[]'` | 字串陣列：使用者追蹤的城市。前端拿這個陣列去呼叫 `/api/weather` 查每個城市的天氣。 |
| `created_at` | `TIMESTAMPTZ(6)` | `now()` | 用 `TIMESTAMPTZ` 不用 `TIMESTAMP`：API 一律用 ISO 字串 `toISOString()` 跨時區傳輸。`(6)` 指微秒精度（PG 預設）。 |

**為什麼這張表沒有 `updated_at`？** 設計選擇：行程本體幾乎不更新（除了草稿期），且 `daily_itineraries` 的「實質更新時間」沒有意義（嵌入大量子資料）。需要時間軸時看 `created_at` 與子表（如 `expenses.updated_at`）即可。

### 2.2 `trip_participants` — 行程參與者

```sql
CREATE TABLE trip_participants (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  display_name  TEXT         NOT NULL,
  email         TEXT,
  user_id       UUID,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  -- CHECK trip_participants_display_name_not_empty:  char_length(trim(display_name)) > 0
);
CREATE INDEX trip_participants_trip_id_idx ON trip_participants(trip_id);
```

| 欄位 | 型別 | 設計邏輯 |
|---|---|---|
| `id` | `UUID` | 同 trips。 |
| `trip_id` | `UUID FK CASCADE` | 行程刪 → 成員刪。Index 是給 `WHERE trip_id = ?` 列表查詢用的（route: `GET /api/trips/:tripId/participants`）。 |
| `display_name` | `TEXT NOT NULL` | 顯示名稱。CHECK 確保 trim 後非空（避免空白字元矇混過 NOT NULL）。 |
| `email` | `TEXT` *nullable* | 提醒寄信用。為什麼 nullable？因為「Bob」可能是「我朋友 Bob 沒給 email」的純記名成員。沒 email 時提醒會落到 `REMINDER_FALLBACK_EMAIL`。 |
| `user_id` | `UUID` *nullable* | **預留未來**：若日後成員可以是「真的有後台帳號的 admin」，這欄會 link 到 `admin_users.id`。目前所有 row 都是 NULL。Supabase 時代曾 link 到 `auth.users`，遷移時保留欄位但拔掉 FK。 |
| `created_at` | `TIMESTAMPTZ` | 通常用作排序（先加入的成員列前面）。 |

**設計選擇：為什麼不用 (trip_id, display_name) 做 unique？**  
允許「我有兩個叫 John 的朋友」。前端用 UUID 做去重，使用者體驗更直觀。

### 2.3 `expenses` — 花費主檔

```sql
CREATE TABLE expenses (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         UUID            NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  title           TEXT            NOT NULL,
  amount_total    DECIMAL(14, 2)  NOT NULL,
  currency        TEXT            NOT NULL DEFAULT 'TWD',
  exchange_rate   DECIMAL(18, 8)  NOT NULL DEFAULT 1,
  payer_id        UUID            NOT NULL
                  REFERENCES trip_participants(id) ON DELETE RESTRICT,
  expense_date    DATE            NOT NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
  -- CHECK expenses_amount_total_non_negative:  amount_total >= 0
  -- CHECK expenses_exchange_rate_positive:     exchange_rate > 0
  -- CHECK expenses_title_not_empty:            char_length(trim(title)) > 0
);
CREATE INDEX expenses_trip_id_idx                       ON expenses(trip_id);
CREATE INDEX expenses_trip_id_expense_date_desc_idx     ON expenses(trip_id, expense_date DESC);
```

| 欄位 | 型別 | 設計邏輯 |
|---|---|---|
| `id` | `UUID` | 同上。 |
| `trip_id` | `UUID FK CASCADE` | 行程刪 → 花費刪。 |
| `title` | `TEXT NOT NULL` | 「機票」、「東京迪士尼」等。CHECK 確保 trim 後非空。 |
| `amount_total` | `DECIMAL(14, 2)` | **為什麼是 14,2？** 14 位數總長 + 2 位小數，可表達到 999,999,999,999.99（一兆元級別），夠用且**避免 floating-point 累積誤差**。Prisma TS 端會 toString() / parseNumeric() 序列化成 number。 |
| `currency` | `TEXT DEFAULT 'TWD'` | 故意用 TEXT 不用 ISO 4217 enum：偶爾使用者打 `JPY`、`USD` 等三字母代碼，沒必要強驗。前端 dropdown 限制常用幾種。 |
| `exchange_rate` | `DECIMAL(18, 8)` | **為什麼是 18,8？** 匯率小數位需要極高精度（如 1 USD = 31.42537000 TWD），8 位小數對應金融常見精度。CHECK 強制 > 0（不可零或負）。 |
| `payer_id` | `UUID FK RESTRICT` | **付款人。RESTRICT 是這個專案最關鍵的設計選擇之一**：刪除一名 participant 時，若還有他付過的 expense，必須先刪那些 expense。這比「悄悄把 expense 變成 NULL payer」安全。配合 `services/participants.ts` 的 `isInLedger()` 預檢，UI 會回 409 並顯示「此成員仍有花費或分攤紀錄，無法刪除」。 |
| `expense_date` | `DATE` | 為什麼這個用 `DATE` 而 `trips.start_date` 用 TEXT？因為花費要做「依日期 sort 並列出」的查詢（見索引 `expenses_trip_id_expense_date_desc_idx`），用 `DATE` 才能正確排序與索引。trips 的 start/end 只是顯示，不索引。 |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | 兩個都有：花費會被編輯（修改金額、改付款人），UI 用 `updated_at` 做「最近變動」感知。**注意：服務層 update 時會手動 set `updated_at = new Date()`**，因為 Prisma 預設不會自動更新。 |

**索引設計**：
- `expenses_trip_id_idx`：給「列出某行程所有花費」用。
- `expenses_trip_id_expense_date_desc_idx`：複合索引給 `ORDER BY expense_date DESC, created_at DESC`（API 預設排序）。注意 PG 索引的 `DESC` 對單欄 ASC 查詢仍可用，這裡顯式寫 `DESC` 是為了讓「最近的花費在最上面」這個常見 query 走 index scan。

### 2.4 `expense_splits` — 分帳明細

```sql
CREATE TABLE expense_splits (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id      UUID            NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  participant_id  UUID            NOT NULL REFERENCES trip_participants(id) ON DELETE CASCADE,
  owed_amount     DECIMAL(14, 2)  NOT NULL
  -- CHECK expense_splits_owed_non_negative: owed_amount >= 0
);
CREATE UNIQUE INDEX expense_splits_expense_participant_unique
  ON expense_splits(expense_id, participant_id);
CREATE INDEX expense_splits_expense_id_idx       ON expense_splits(expense_id);
CREATE INDEX expense_splits_participant_id_idx   ON expense_splits(participant_id);
```

| 欄位 | 型別 | 設計邏輯 |
|---|---|---|
| `id` | `UUID` | 雖然 (expense_id, participant_id) 已 unique，但仍有獨立 PK，方便前端做 row-level 操作（如「移除這一個 split」）。 |
| `expense_id` | `UUID FK CASCADE` | 花費刪 → 分帳明細刪。 |
| `participant_id` | `UUID FK CASCADE` | **這裡 CASCADE 而非 RESTRICT**。和 `payer_id` 不同：作為「分帳對象」的成員被刪時，分帳記錄一起消失是合理的（系統視為他不再參與），但他**仍會被 `payer_id` 的 RESTRICT 擋住**。換句話說：能刪一名 participant ⇔ 他既非任何 expense 的 payer，也沒有 split 記錄（後者由 `services/participants.ts` 的 `isInLedger()` 檢查實現）。 |
| `owed_amount` | `DECIMAL(14, 2)` | 這名成員應分攤金額。CHECK 強制 >= 0（不允許負分攤）。 |

**索引設計**：
- `expense_splits_expense_participant_unique`：UNIQUE 確保「一筆 expense 對同一 participant 不會有兩條 split」（避免重複加分帳）。
- 兩個方向的單欄 index 給雙向查詢用：「這筆 expense 有哪些 split」 / 「這名 participant 出現在哪些 split」。

**為什麼不存 `paid_amount`？** 設計選擇：這個系統採用「總額 + 分攤明細」模型，`paid_amount` 永遠 = `expense.amount_total`（付款人付全額），所以省欄位。如果未來支援「多人共同付款」，再加 `paid_amount`。

**結算（settlement）邏輯**：在前端 `apps/web/src/lib/settlement.ts` 實作，DB 不存「誰欠誰多少」。每次計算都從 expense + split 即時推導，避免 stale 資料。

### 2.5 `todos` — 提醒佇列備份

```sql
CREATE TABLE todos (
  id                          UUID         PRIMARY KEY,           -- 注意：無 default
  trip_id                     UUID         NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  task_name                   TEXT         NOT NULL,
  reminder_time               TIMESTAMPTZ  NOT NULL,
  assigned_participant_id     UUID         REFERENCES trip_participants(id) ON DELETE SET NULL,
  is_notified                 BOOLEAN      NOT NULL DEFAULT FALSE,
  retry_count                 INTEGER      NOT NULL DEFAULT 0,
  job_id                      TEXT,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

> **關鍵差異**：這張表的 `id` 沒有 `DEFAULT gen_random_uuid()`！為什麼？

**設計邏輯**：`todos` 是 `trips.todos` JSONB 陣列裡那個 `TodoItem.id` 的「投影」。前端先在 `trips.todos` 裡產生一個 todo（含 client-generated UUID），如果該 todo 有 `remindTime`，service 才會 upsert 一筆 `todos` row 共用同一個 UUID。這樣：

- DB 層的 todo row 是 BullMQ 排程與寄信稽核用，**不是 source of truth**。
- 前端只看 `trips.todos` JSONB（單次 query 拿全部）。
- 兩者的 `id` 一致，方便後端做關聯（取消提醒、查 status）。

| 欄位 | 設計邏輯 |
|---|---|
| `id` UUID（無 default） | 由 application 層（`TodosService.upsertReminder`）傳入，與 `trips.todos[].id` 同步。 |
| `trip_id` CASCADE | 行程刪 → 提醒列刪。 |
| `task_name` | 摘自 `TodoItem.text`，方便寄信時 log 顯示。 |
| `reminder_time` `TIMESTAMPTZ` | **跨時區關鍵**：使用者選的時間（如「2026-05-01 08:00」當地）由前端轉成 UTC ISO 字串送來。BullMQ 的 `delay` 計算用 UTC 時間。 |
| `assigned_participant_id` SET NULL | 指派對象。SET NULL 讓「成員刪了但提醒還在」這個情境不爆 FK。寄信時 fallback。 |
| `is_notified` | 已寄 → true。BullMQ 重試時若看到 true 直接 no-op（防重複寄）。 |
| `retry_count` | 寄信失敗的重試計數。BullMQ 自己也有 attempts 概念，這欄是寫入 `email_job_logs` 用的歷史紀錄。 |
| `job_id` | BullMQ 的 jobId。命名規則 `reminder:{todoId}`，由 `apps/api/src/modules/reminder/reminder.constants.ts` 的 `reminderJobId()` 生成。**為什麼存 DB？** 行程刪除時要批次 cancel BullMQ 對應的 delayed jobs（見 `ReminderQueueService.cancelAllForTrip`），需要這個欄位回查。 |
| `created_at` | 排序用（依建立時間列出待辦）。 |

**這張表沒有 unique index 但 id 是 PK** → 不可能重複 todo_id。`upsertTodoReminder` 用 `prisma.todo.upsert({ where: { id }, ... })` 利用此 PK。

### 2.6 `homepage_settings` — 首頁 KV 設定

```sql
CREATE TABLE homepage_settings (
  key         TEXT         PRIMARY KEY,
  value       JSONB        NOT NULL DEFAULT 'null',
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

| 欄位 | 設計邏輯 |
|---|---|
| `key` PRIMARY KEY | 字串 key。常用值：`site_name`、`site_logo`、`intro_video`、`carousel_slides`。為什麼不用 enum / CHECK？因為 key 會增加（將來可能加 `social_links` 等），用 string 最彈性。 |
| `value` JSONB | 任意結構。簡單 key 存字串（`"My Site"`），複雜 key 存陣列（`carousel_slides` 是 `[{imageUrl, title}, ...]`）。前端用 generic `getHomepageSetting<T>(key)` 反序列化。 |
| `updated_at` | 後台改首頁時更新。前端可用作 cache busting key。 |

**為什麼用 KV 不拆表？** 設計選擇：首頁設定是「少量、低頻變動、結構不一」的元資料，拆 8 張表就是 over-engineering。KV 的代價是 PG 不能對 value 做型別檢查，但前端 zod schema 補強了這層。

### 2.7 `email_job_logs` — 提醒寄信稽核

```sql
CREATE TABLE email_job_logs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_at    TIMESTAMPTZ  NOT NULL,
  total_found     INTEGER      NOT NULL,
  sent_count      INTEGER      NOT NULL,
  details         JSONB        NOT NULL,
  source          TEXT         NOT NULL DEFAULT 'bullmq',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

| 欄位 | 設計邏輯 |
|---|---|
| `id` | 一次 worker 執行 → 一行 log。 |
| `triggered_at` | Worker 函式進入時的時間點（與 `created_at` 通常差幾毫秒，分開記是因為理論上 trigger → 寫 log 之間可能有可觀察的處理延遲）。 |
| `total_found` / `sent_count` | 該次處理「找到 N 筆 / 成功寄出 M 筆」。多數情況 N=1, M=0 或 1（一個 BullMQ job 處理一個 todo）。 |
| `details` JSONB | `EmailJobDetail[]`：每個 todo 的 `{ todo_id, task_name, trip_title, status, retry_count, error? }`。`status` 為 `'sent' / 'failed' / 'abandoned'`。**這是稽核重點**：寄信失敗時會留下錯誤原因，admin 用 SQL pivot 查問題。 |
| `source` | 預設 `'bullmq'`。歷史上曾有 `'cron'`（Supabase Cron 時代）值。保留欄位讓查詢可以區分。 |
| `created_at` | DB row 寫入時間，用作排序。 |

**為什麼不索引？** 容量計算：每個提醒 1 row，假設一個月 1000 個提醒 → 一年 12k 行。完全可以全表掃描。等有 100k+ 行才考慮加 `(created_at DESC)` 索引或時間 partition。

### 2.8 `admin_users` — 後台帳號

```sql
CREATE TABLE admin_users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT         NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

| 欄位 | 設計邏輯 |
|---|---|
| `id` UUID | 用作 JWT 的 `sub` claim。 |
| `email` UNIQUE | 登入 identifier。`AuthService.findAdminByEmail` 會 `.trim().toLowerCase()` 標準化，`AdminUsersService.create` 寫入時也標準化，所以 unique 比較不會被「ALICE@ vs alice@」騙過。 |
| `password_hash` | bcrypt rounds=12（見 `apps/api/src/modules/auth/auth.service.ts:hashPassword`）。**永遠不直接存原始密碼**。 |
| `created_at` / `updated_at` | 改密碼時 service 手動 set `updated_at`。 |

**為什麼這張表不存「角色 / 權限」？** 設計選擇：目前所有 admin 都是 super admin（後台所有功能皆可用）。未來要分權再加 `role` 欄位 + 路由 guard。

**初始 admin 怎麼來？**：`apps/api/src/db/seed.ts` 讀 `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`，第一次跑 `npm run db:seed` 時建立。日後新增 admin 走後台 UI（`POST /api/admin/users`）。

---

## 3. JSONB 欄位深度解析

`trips` 用了 7 個 JSONB 欄位。為什麼不全部拆關聯表？三個原則：

1. **「子實體不會被外部 query」** → 適合 JSONB（讀取場景就是「某 trip 的 X」）。
2. **「子實體是行程私有屬性」** → 不需要跨 trip aggregation。
3. **「子實體變動會與行程一起變動」** → JSONB 整批更新比 join + 多表 transaction 簡單。

但 `expenses` 和 `trip_participants` 不在這三條規則裡（會跨 trip 算結帳、會跨 expense join），所以拆表。

### 3.1 `trips.todos` — `TodoItem[]`

```ts
interface TodoItem {
  id: string;                    // client UUID（與 todos 表的 id 同步）
  text: string;
  checked: boolean;              // 前端 checkbox 狀態
  dueAt?: string | null;         // ISO 截止時間（顯示用）
  remindTime?: string | null;    // ISO 提醒時間（會排 BullMQ）
  remindOffset?: number | null;  // 「截止前 N 分鐘提醒」的偏移
  assignedParticipantId?: string | null;
}
```

**為什麼用 JSONB 不拆 `trip_todos` 表？**

主要理由：「server-side read-modify-write 問題」。前端編輯行程的 todo 列表時，每次按 checkbox 都要送整個 todos 陣列嗎？不，後端用 `PATCH /api/trips/:id/todos` 接受**單一操作**（`{ op: { type: 'toggle', id, checked } }`）並用 `SELECT ... FOR UPDATE` 序列化更新。這個 RMW pattern 用 JSONB 簡單、用拆表會涉及 todos 表的事務鎖。

詳細實作見 `apps/api/src/modules/trips/trips.service.ts` 的 `patchTodos` method。

> **注意**：如果 todo 有 `remindTime`，會 trigger `apps/api/src/modules/todos/todos.service.ts` 的 `upsertReminder`，該 service 會在 `todos` 表寫一筆對應 row（共用同 id）。所以同一個 todo 可能同時存在於兩個地方。

### 3.2 `trips.flights` — `FlightInfo`

```ts
interface FlightInfo {
  departure: FlightDetail;
  return: FlightDetail;
}
interface FlightDetail {
  airline: string;
  flightNumber: string;
  departureTime: string;     // 通常是 ISO 字串
  arrivalTime: string;
  departureAirport: string;
  arrivalAirport: string;
  checkedBaggage: number;    // 件數
  carryOnBaggage: number;
}
```

**為什麼預設值是 `{"departure":{},"return":{}}` 而不是 `{}`？**  
前端永遠期待 `flights.departure` / `flights.return` 兩個物件存在。預設好兩個空物件，前端不需要先判斷 `flights?.departure?.airline ?? ''`，避免 ESLint optional chaining 大爆炸。

### 3.3 `trips.hotels` — `HotelInfo[]`

```ts
interface HotelInfo {
  id: string;                  // client UUID
  name: string;
  checkIn: string;
  checkOut: string;
  address: string;
  confirmationNumber: string;
  placeId?: string;            // Google Place ID（可選）
  lat?: number;
  lng?: number;
}
```

陣列大多 1-3 筆，省得拆表。`placeId` 有時前端會用 Google Maps 補座標。

### 3.4 `trips.daily_itineraries` — `DailyItinerary[]`

```ts
interface DailyItinerary {
  date: string;                // YYYY-MM-DD
  activities: ActivityCard[];
}
interface ActivityCard {
  id: string;
  title: string;
  type: string;                // 'food', 'sightseeing', 'transport' …
  time?: string;
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  notes: string;               // 可能含 base64 圖片，所以 body limit 設 10mb
}
```

**這是行程裡最大的欄位**。多日行程含多個活動，每個活動的 `notes` 可能內嵌 base64 縮圖。極端情況單筆 trip 的這欄位可達 ~5MB。

**設計後果**：
- API `main.ts` 的 body parser 設 `{ limit: '10mb' }`（不是預設 100kb）。
- 列表 API（`GET /api/trips`）刻意 select 只取 summary 欄位，**不回傳 `daily_itineraries`**，避免列表頁拉幾十筆 trip 時把瀏覽器記憶體撐爆。
- `GET /api/trips/:id` 才回傳完整資料。

### 3.5 `trips.luggage_list` — `LuggageCategory[]`

```ts
interface LuggageCategory {
  id: string;
  name: string;                // '電子產品', '盥洗用品' …
  items: LuggageItem[];
  participantId?: string;      // 該分類由誰負責（顯示頭像）
}
interface LuggageItem {
  id: string;
  text: string;
  checked: boolean;
}
```

雙層巢狀（分類 → items）。同樣是「整批讀寫」場景。

`GET /api/trips`（summary）**有**回這欄，因為 list 頁面有顯示「已準備好幾項行李」的進度條。

### 3.6 `trips.shopping_list` — `ShoppingItem[]`

```ts
interface ShoppingItem {
  id: string;
  status: 'incomplete' | 'complete';
  name: string;
  location: string;            // '東京迪士尼商店'
  price: number;               // 預估金額
  participantId?: string;
}
```

平坦陣列，無巢狀。也在 summary API 回傳（list 頁顯示「想買 N 件，已買 M 件」）。

### 3.7 `trips.weather_cities` — `string[]`

最簡單的 JSONB：純字串陣列，例如 `["Tokyo", "Kyoto"]`。前端用這個列表呼叫 `/api/weather/geocode` + `/api/weather` 顯示天氣卡。

---

## 4. CHECK 約束、索引、外鍵策略

### 4.1 CHECK 約束（在 `prisma/sql/check_constraints.sql`）

Prisma DSL 不支援 CHECK constraint，所以抽到 SQL 檔案，由 `apps/api/scripts/applyCheckConstraints.ts` 在 `prisma migrate deploy` 後跑（`db:migrate` 會自動串起來）。

| 約束名 | 表 | 規則 | 為什麼 |
|---|---|---|---|
| `trips_category_enum` | trips | `category IN ('domestic','international')` | 列舉值。為什麼不用 PG ENUM？enum 加值要 `ALTER TYPE`，比 CHECK 不易演進。 |
| `trips_status_enum` | trips | `status IN ('planning','ongoing','completed')` | 同上。 |
| `trip_participants_display_name_not_empty` | trip_participants | `char_length(trim(display_name)) > 0` | 防空字串/純空白。比 NOT NULL 更嚴。 |
| `expenses_amount_total_non_negative` | expenses | `amount_total >= 0` | 不允許負花費（退款邏輯應該是另一筆 expense）。 |
| `expenses_exchange_rate_positive` | expenses | `exchange_rate > 0` | 匯率 0 / 負數沒意義。 |
| `expenses_title_not_empty` | expenses | `char_length(trim(title)) > 0` | 同 display_name。 |
| `expense_splits_owed_non_negative` | expense_splits | `owed_amount >= 0` | 分攤金額不可負。 |

**為什麼這些 CHECK 不在 service 層做就好？** 要的就是「即使有人繞過 API 直接連 DB（例如手跑 SQL、用 Prisma Studio 改）也不會破壞資料完整性」。Application-level 驗證會被人類失誤繞過，DB 層 CHECK 不會。

### 4.2 索引總表

| 表 | 索引 | 欄位 | 用途 |
|---|---|---|---|
| `trips` | （PK） | id | — |
| `trip_participants` | （PK） | id | — |
| `trip_participants` | trip_participants_trip_id_idx | trip_id | `WHERE trip_id = ?` 列出成員 |
| `expenses` | （PK） | id | — |
| `expenses` | expenses_trip_id_idx | trip_id | 「列出某行程花費」 |
| `expenses` | expenses_trip_id_expense_date_desc_idx | (trip_id, expense_date DESC) | 同上但排序版（API 預設 ORDER BY expense_date DESC, created_at DESC） |
| `expense_splits` | （PK） | id | — |
| `expense_splits` | expense_splits_expense_participant_unique | (expense_id, participant_id) UNIQUE | 防止同 expense 對同 participant 重複 split |
| `expense_splits` | expense_splits_expense_id_idx | expense_id | 從 expense 撈 splits |
| `expense_splits` | expense_splits_participant_id_idx | participant_id | 從 participant 撈他在哪些 split（`isInLedger` 用） |
| `todos` | （PK） | id | — |
| `homepage_settings` | （PK） | key | 直接 key 查 |
| `email_job_logs` | （PK） | id | — |
| `admin_users` | （PK） | id | — |
| `admin_users` | UNIQUE | email | 登入查找 + 防重複建立 |

**沒索引的欄位也是設計選擇**：例如 `trips.start_date` 沒索引——目前沒有「依日期區間 query 行程」的 API，加了徒增寫入成本。

### 4.3 外鍵級聯策略總表

| 子表 | 父表 | 欄位 | 級聯 | 為什麼 |
|---|---|---|---|---|
| trip_participants | trips | trip_id | **CASCADE** | 行程刪 → 成員列無意義。 |
| expenses | trips | trip_id | **CASCADE** | 同上。 |
| expense_splits | expenses | expense_id | **CASCADE** | 花費刪 → 分帳明細無意義。 |
| expense_splits | trip_participants | participant_id | **CASCADE** | 成員刪 + 沒擋住 → 分帳明細跟著消（但實務上 service 層的 `isInLedger` 會先擋下刪除）。 |
| expenses | trip_participants | payer_id | **RESTRICT** | **故意不級聯**。要刪這名 participant 必須先把他付款的 expense 處理掉。比 SET NULL 安全（不會留下「孤兒 expense」）。 |
| todos | trips | trip_id | **CASCADE** | 行程刪 → 提醒列刪。 |
| todos | trip_participants | assigned_participant_id | **SET NULL** | 指派對象刪 → 提醒不消失，只是失指派。寄信會 fallback。 |

**核心設計哲學**：
- **資料樹（行程的子實體）**：CASCADE — 父消子滅是合理的。
- **付款引用**：RESTRICT — 強迫 admin 先處理 expense 再刪人，避免悄悄丟失財務資料。
- **指派引用**：SET NULL — 刪人不該影響提醒邏輯，UI 端會回 fallback 行為。

---

## 5. 慣例與設計原則

### 5.1 命名

- **DB 欄位**：snake_case（PG 慣例）。例：`trip_id`, `created_at`。
- **Prisma client / TypeScript**：camelCase。例：`tripId`, `createdAt`。
- **轉換**：Prisma DSL 用 `@map("trip_id")` 把欄位名映射到 snake_case。整段 schema 都遵循。
- **表名**：複數 + snake_case，由 `@@map("trips")` 等聲明。
- **索引名**：`<表名>_<欄位>_idx` 或描述用途的長名稱（`expenses_trip_id_expense_date_desc_idx`）。

### 5.2 主鍵 / UUID 策略

- **全部表用 UUID v4**（`gen_random_uuid()`）。
- 例外：`homepage_settings.key` 用字串 PK；`todos.id` 來自 application（無 default）。
- **為什麼不用 BIGINT 自增？**
  - 前端可以**先生 UUID 再送 API**，網路重試 idempotent。
  - 不洩漏 row 數量資訊（INT 自增 ID 等於告訴外人「我們系統有 N 筆 trip」）。
  - 跨表合併資料時不會撞 ID。
- **代價**：UUID 比 BIGINT 寬（16 vs 8 bytes），且 `gen_random_uuid()` 隨機分布破壞 B-tree 索引的局部性。在 1M+ row 等級才會有感，目前無虞。

### 5.3 時間戳記

- **TIMESTAMPTZ(6)**：所有時間欄位（包含 `expense_date` 例外用 `DATE`）。
- **API 一律輸出 ISO 字串**：service 層用 `.toISOString()` 轉，前端用 `Date.parse()` 反解。
- **不存使用者時區**：前端負責顯示時轉換。
- **遊歷日期 vs 提醒時間**：前者（`trips.start_date`）是「使用者腦裡的當地日期」用 TEXT；後者（`todos.reminder_time`）是「絕對時間點」用 TIMESTAMPTZ。

### 5.4 Decimal 精度

| 欄位 | 精度 | 為什麼 |
|---|---|---|
| `expenses.amount_total` | DECIMAL(14, 2) | 一兆元級別 + 元角分。 |
| `expenses.exchange_rate` | DECIMAL(18, 8) | 匯率高精度。 |
| `expense_splits.owed_amount` | DECIMAL(14, 2) | 與 amount_total 同精度。 |

**TypeScript 端的處理**：Prisma 把 Decimal 轉成 `Prisma.Decimal` 物件，service 層用 `.toString()` 序列化、`parseNumeric()` 反序列化（見 `apps/api/src/modules/expenses/expenses.service.ts`）。**API JSON 一律用 number 表示**金額，浮點誤差由前端結算邏輯（`apps/web/src/lib/settlement.ts`）容忍 0.01 內差異。

### 5.5 NULL 政策

- **預設 `NOT NULL` + 提供 default value**（特別是 JSONB 用 `'[]'` / `'{}'` / `'null'` 預設）。
- **NULL 只在「真的可以缺」**：`trip_participants.email`、`trip_participants.user_id`、`todos.assigned_participant_id`、`todos.job_id`。
- 這個策略是因為前端**永遠期待欄位存在**（不需 `?? ''` 大爆炸）。

### 5.6 Migration 流程

```
編輯 prisma/schema.prisma
    ↓
npm run db:generate -w @trip-planner/api    （prisma migrate dev）
    ↓
prisma 產生新 SQL → prisma/migrations/<timestamp>_<name>/migration.sql
    ↓
本機自動套用
    ↓
推 git
    ↓
部署環境跑 npm run db:migrate -w @trip-planner/api
    ↓ ① prisma migrate deploy（套 migration）
    ↓ ② tsx scripts/applyCheckConstraints.ts（套 CHECK，idempotent）
```

如果改了 `prisma/sql/check_constraints.sql`，**不需要產 migration**（idempotent script 直接覆蓋）。

### 5.7 「誰是 source of truth」

| 概念 | source of truth | 同步副本 |
|---|---|---|
| 行程主資訊 | `trips` row | — |
| 行程 todo 列表 | `trips.todos` JSONB | `todos` 表（只有設提醒的會出現） |
| 提醒寄信狀態 | `todos.is_notified` + `email_job_logs` | — |
| 結帳「誰欠誰」 | （不存）— `expenses` + `expense_splits` 即時推導 | — |
| 後台帳號 | `admin_users` | — |
| 首頁設定 | `homepage_settings` | — |

**重要**：「結帳數字不存資料庫」是設計原則。每次計算都從原始 expense + split 推導，避免「快取的結算數字」與「實際 expense」不同步。

---

## 附錄：常用維運查詢

```sql
-- 1. 列出所有 trip 的 todo 數量（看 JSONB array length）
SELECT id, title, jsonb_array_length(todos) AS todo_count
  FROM trips
 ORDER BY todo_count DESC LIMIT 20;

-- 2. 檢查 split 一致性：每筆 expense 的 split 總額應該 ≈ amount_total
SELECT e.id, e.title, e.amount_total, COALESCE(SUM(s.owed_amount), 0) AS split_sum
  FROM expenses e
  LEFT JOIN expense_splits s ON s.expense_id = e.id
 GROUP BY e.id
 HAVING ABS(e.amount_total - COALESCE(SUM(s.owed_amount), 0)) > 0.01;

-- 3. 找出有提醒但 BullMQ jobId 為 NULL 的 todo（需要 reseedReminders）
SELECT id, task_name, reminder_time
  FROM todos
 WHERE reminder_time > NOW()
   AND is_notified = false
   AND job_id IS NULL;

-- 4. 寄信失敗統計（最近 30 天）
SELECT date_trunc('day', triggered_at) AS day,
       COUNT(*) FILTER (WHERE details->0->>'status' = 'sent') AS sent,
       COUNT(*) FILTER (WHERE details->0->>'status' = 'failed') AS failed
  FROM email_job_logs
 WHERE triggered_at > NOW() - INTERVAL '30 days'
 GROUP BY 1 ORDER BY 1 DESC;

-- 5. 哪些 admin 最近沒登入（沒辦法直接看，但可看 updated_at 有沒有改密碼）
SELECT email, created_at, updated_at FROM admin_users ORDER BY updated_at DESC;

-- 6. 找孤兒 split（理論上不該存在，CASCADE 會清，但若手動操作 DB 可能殘留）
SELECT s.* FROM expense_splits s
  LEFT JOIN expenses e ON e.id = s.expense_id
 WHERE e.id IS NULL;

-- 7. 用 jsonb_path_query 撈所有有設提醒的 todo（從 trips.todos 攤平）
SELECT t.id AS trip_id,
       (item->>'id') AS todo_id,
       (item->>'text') AS task_name,
       (item->>'remindTime') AS remind_time
  FROM trips t,
       jsonb_array_elements(t.todos) item
 WHERE item->>'remindTime' IS NOT NULL
 ORDER BY (item->>'remindTime')::timestamptz;

-- 8. 一名成員到底「在 ledger 裡」嗎？— 對應 services/participants.ts 的 isInLedger
SELECT EXISTS(
  SELECT 1 FROM expenses
   WHERE trip_id = $1 AND payer_id = $2
) OR EXISTS(
  SELECT 1 FROM expense_splits s
  JOIN expenses e ON e.id = s.expense_id
   WHERE e.trip_id = $1 AND s.participant_id = $2
);
```
