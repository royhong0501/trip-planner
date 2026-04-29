# 第一階段教學大綱：資料庫

> **教學對象**：完全沒碰過後端 / 只寫過前端 localStorage 的新手
> **使用素材**：`apps/api/prisma/schema.prisma`、`apps/api/prisma/sql/check_constraints.sql`、`docs/DATABASE.md`
> **預估時數**：每課 60–90 分鐘，共 13 課，總計約 15–20 小時
> **完成後能力**：能讀懂本專案 schema、寫基本 Prisma 查詢、改欄位並完成 migration、判斷該拆表還是用 JSONB

---

## 教學設計原則

1. **每課一個動手練習** — 讀完一定要打字、跑指令、看到結果。
2. **先具體後抽象** — 用 `admin_users`（4 欄位、無關聯）入門，最後才碰 `trips`（複雜 JSONB）。
3. **錯誤是教材** — 故意做出會被 DB 拒絕的操作，學習 CHECK / FK 真實作用。
4. **驗收問題** — 每課結尾 3–5 題，答得出來才進下一課。

---

## 課表總覽

| 課 | 主題 | 主要素材表 | 核心概念 |
|---|---|---|---|
| 01 | 資料庫是什麼、為什麼要 | — | 持久化、關聯式 vs NoSQL |
| 02 | 表與基本欄位型別 | `admin_users` | PK / NOT NULL / UNIQUE / 型別 |
| 03 | SQL 基礎 CRUD | `admin_users` | SELECT / INSERT / UPDATE / DELETE |
| 04 | 一對多關聯與外鍵 | `trips` ↔ `trip_participants` | FK、ON DELETE CASCADE |
| 05 | 進階級聯策略 | `expenses` / `expense_splits` / `todos` | RESTRICT / SET NULL / CASCADE 取捨 |
| 06 | 索引基礎 | `expenses` | 查詢加速、UNIQUE index、複合索引 |
| 07 | CHECK 約束與資料完整性 | `expenses` / `trip_participants` | DB 層防呆 vs 程式層驗證 |
| 08 | JSONB 入門 | `trips.weather_cities` / `trips.todos` | 何時拆表、何時內嵌 |
| 09 | 時間與精度的坑 | `trips.start_date` / `expenses.amount_total` | TIMESTAMPTZ / DATE / DECIMAL |
| 10 | 從 Schema 到 Code：Prisma ORM | `schema.prisma` | ORM 概念、generator、camelCase 對映 |
| 11 | Migration 工作流 | `prisma/migrations/*` | dev vs deploy、雙段式 migrate |
| 12 | Seed 資料與本機環境 | `apps/api/src/db/seed.ts` | docker-compose、env、初始資料 |
| 13 | 維運查詢與一致性檢查（選修進階） | `DATABASE.md` 附錄 | EXPLAIN、孤兒資料、jsonb_path_query |

---

## 第 01 課：資料庫是什麼，為什麼要它

**學習目標**：理解「為什麼前端的 localStorage 不夠用」、知道關聯式資料庫的角色。

**內容**：
- 故事引入：「想像 trip-planner 把行程存在 localStorage，會出什麼問題？」（換瀏覽器看不到、別人沒辦法跟你共用、清快取就消失）
- 後端 + DB 的分工示意圖
- 關聯式（PostgreSQL、MySQL）vs 文件型（MongoDB）vs KV（Redis）的差異
- 為什麼這個專案選 PostgreSQL：強型別、ACID 事務、JSONB（半結構化也能塞）
- 介紹 `docker-compose.yml` 中的 `postgres` service，以及版本鎖定（PostgreSQL 16）

**動手練習**：
1. `docker compose up -d postgres` 把 PG 跑起來
2. 用 `psql` 或 DBeaver 連線（`localhost:5432`）
3. 執行 `SELECT version();` 確認連到 PG 16

**驗收問題**：
- 為什麼資料庫要跑在 server，而不是直接讓前端讀檔案？
- 講三個 PostgreSQL 比 localStorage 強的點。
- 為什麼版本要鎖定（不寫 `postgres:latest`）？

---

## 第 02 課：表與基本欄位型別

**學習目標**：能讀懂一張簡單的 CREATE TABLE 語句，認得 `PRIMARY KEY` / `NOT NULL` / `UNIQUE` / `DEFAULT`。

**內容**：
- 用 `admin_users`（最簡單的表）逐欄解析
  ```sql
  CREATE TABLE admin_users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT         NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
  );
  ```
- 概念：
  - **PRIMARY KEY**：每行的唯一識別。為什麼要它？
  - **NOT NULL**：禁止空值。空值在 SQL 裡是個坑（NULL ≠ NULL）。
  - **UNIQUE**：防止重複（為什麼 `email` 要 UNIQUE）。
  - **DEFAULT**：插入時沒給就用預設。
- 為什麼 `id` 用 UUID 不用自增 INT（先簡單講「不洩漏總筆數」、「前端可預生」，第 5 課再深入）
- 為什麼密碼欄位叫 `password_hash` 不叫 `password`（永遠不存原文）

**動手練習**：
1. 在 Prisma Studio (`npx prisma studio`) 開啟 `admin_users`
2. 手動新增一筆 admin（注意：`password_hash` 用 bcrypt 產出來，不是隨便填字串）
3. 再新增一筆 email 重複的 → 看 DB 怎麼拒絕你
4. 試把 `email` 留空 → 看 NOT NULL 報錯

**驗收問題**：
- PRIMARY KEY 和 UNIQUE 差在哪？
- 為什麼這張表沒有 `username` 欄位？
- `DEFAULT now()` 是在前端、後端、還是 DB 層執行？

---

## 第 03 課：SQL 基礎 CRUD

**學習目標**：能用 SQL 對 `admin_users` 做四種基本操作。

**內容**：
- `SELECT * FROM admin_users;`
- `SELECT email FROM admin_users WHERE created_at > '2026-01-01' ORDER BY created_at DESC LIMIT 10;`
- `INSERT INTO admin_users (email, password_hash) VALUES ('test@example.com', '...');`
- `UPDATE admin_users SET email = 'new@example.com' WHERE id = '...';`
- `DELETE FROM admin_users WHERE email = '...';`
- 強調：**沒寫 WHERE 的 UPDATE / DELETE 會炸全表**（demo 一次給他看）

**動手練習**：
1. 用 SQL 撈出最近 5 個建立的 admin
2. 用 SQL 改自己的 email
3. 故意執行 `DELETE FROM admin_users;`（不加 WHERE），用 transaction 包住再 `ROLLBACK` 救回來
   ```sql
   BEGIN;
   DELETE FROM admin_users;
   SELECT count(*) FROM admin_users;  -- 看到 0
   ROLLBACK;
   SELECT count(*) FROM admin_users;  -- 救回來了
   ```

**驗收問題**：
- 如果忘了寫 WHERE，DELETE 會發生什麼事？要怎麼預防？
- ORDER BY 預設是 ASC 還是 DESC？
- `WHERE email = NULL` 為什麼撈不到 NULL 的 row？（要用 `IS NULL`）

---

## 第 04 課：一對多關聯與外鍵

**學習目標**：理解 1:N 關係、為什麼要 FK、CASCADE 是什麼。

**內容**：
- 用 `trips` ↔ `trip_participants` 開講：「一個行程可以有很多成員」
- FK 的意義：
  - 在 `trip_participants` 加上 `trip_id UUID REFERENCES trips(id)`，DB 會幫你擋下「指向不存在 trip 的 row」
  - 這是 **資料完整性**（referential integrity）
- ON DELETE 策略入門：CASCADE
  - 刪一個 trip 時，它的 participants 會自動跟著消
  - 為什麼？想想看，如果不刪會留下「孤兒成員」
- Prisma DSL 對應寫法：
  ```prisma
  trip Trip @relation(fields: [tripId], references: [id], onDelete: Cascade)
  ```

**動手練習**：
1. INSERT 一個 trip，再 INSERT 三個 participant 都指向那個 trip
2. `SELECT * FROM trip_participants WHERE trip_id = '...';` 看到三筆
3. `DELETE FROM trips WHERE id = '...';` 然後再查一次 participant → 三筆都沒了
4. 故意 INSERT 一個 `trip_id` 是亂打的 UUID 的 participant → 看 FK 拒絕

**驗收問題**：
- FK 是擋哪一個方向的錯誤？（INSERT 子表時擋）
- 沒有 ON DELETE CASCADE 會發生什麼事？
- 「孤兒資料」是什麼？為什麼是壞事？

---

## 第 05 課：進階級聯策略 — CASCADE / RESTRICT / SET NULL

**學習目標**：能對每個 FK 自己決定該用哪種級聯，不是無腦 CASCADE。

**內容**：
- 三種策略的意義：
  - **CASCADE**：父消子滅
  - **RESTRICT**：擋住，叫呼叫者先處理
  - **SET NULL**：父消子留，但欄位變 NULL
- 對照本專案：
  | 場景 | 策略 | 為什麼 |
  |---|---|---|
  | 行程 → 成員 | CASCADE | 行程都沒了，成員列無意義 |
  | 行程 → 花費 | CASCADE | 同上 |
  | 花費 → 付款人 | **RESTRICT** | 不可悄悄消失財務紀錄 |
  | 提醒 → 指派對象 | **SET NULL** | 人刪了提醒還在，寄信時 fallback |
- 把 `DATABASE.md` §4.3 的整張表攤開來討論

**動手練習**：
1. 製造一個有 expense 的 participant，試著直接刪 → DB 會拒絕（RESTRICT）
2. 把該 expense 先刪掉，再刪 participant → 成功
3. 製造一個有 todo 指派給 participant 的情境，刪 participant → todo 還在但 `assigned_participant_id` 變 NULL

**驗收問題**：
- 為什麼 `expenses.payer_id` 不用 CASCADE？「順便把他的 expense 也刪掉」哪裡危險？
- 為什麼 `todos.assigned_participant_id` 用 SET NULL 而不是 RESTRICT？
- `expense_splits.participant_id` 是 CASCADE — 但實務上其實刪不到，為什麼？（因為 service 層會先擋）

---

## 第 06 課：索引基礎

**學習目標**：知道索引是什麼、何時加、何時不加。

**內容**：
- 比喻：索引就像書的「目錄」，沒目錄要全書翻
- DEMO：手動塞 10 萬筆 expenses，分別有 / 沒有 `expenses_trip_id_idx`，跑同一個 query 看時間差
- 用 `EXPLAIN ANALYZE` 觀察 query plan：
  ```sql
  EXPLAIN ANALYZE
  SELECT * FROM expenses WHERE trip_id = '...';
  ```
  比較 `Seq Scan` 和 `Index Scan`
- 三種索引：
  - 單欄 index：`expense_splits_expense_id_idx`
  - 複合 index：`expenses_trip_id_expense_date_desc_idx`（順序很重要！）
  - UNIQUE index：`expense_splits_expense_participant_unique` — 既加速也限制
- **何時不該加索引**：寫多讀少的欄位、低 cardinality 欄位、沒有對應的查詢

**動手練習**：
1. 用 `seed.ts` 的方式塞 5 萬筆假 expense
2. 跑 `EXPLAIN ANALYZE SELECT * FROM expenses WHERE trip_id = '...' ORDER BY expense_date DESC;` 看 cost
3. 試著 `DROP INDEX expenses_trip_id_expense_date_desc_idx;` 再跑一次，看時間變多少
4. 加回來

**驗收問題**：
- 為什麼複合 index 的欄位順序重要？`(a, b)` 和 `(b, a)` 有差嗎？
- 為什麼 `email_job_logs` 沒有索引也沒事？
- UNIQUE index 是同時做兩件事，是哪兩件？

---

## 第 07 課：CHECK 約束與資料完整性

**學習目標**：理解 DB 層驗證的意義、能寫一個 CHECK。

**內容**：
- 場景：「我已經在 service 層擋了負金額，為什麼 DB 還要再擋？」
  - 回答：`prisma studio` 直接改、SQL 手跑、未來新工程師寫了 bypass 的 API…應用層不可信
- 看 `apps/api/prisma/sql/check_constraints.sql` 整個檔案
- 為什麼這專案把 CHECK 抽成獨立 SQL：Prisma DSL 不支援，要 raw SQL 補
- 為什麼用 `CHECK + TEXT` 而不是 PG `ENUM`：ALTER TYPE 不易演進
- 看 `applyCheckConstraints.ts` 的 idempotent 寫法（DROP IF EXISTS + CREATE）

**動手練習**：
1. 在 SQL 裡跑 `INSERT INTO expenses (..., amount_total, ...) VALUES (..., -100, ...);` → 看 CHECK 拒絕
2. 跑 `INSERT ... category = 'space'` → 看 enum CHECK 拒絕
3. 自己加一個 CHECK 限制 `expenses.title` 長度 ≤ 200，跑 migration

**驗收問題**：
- 應用層驗證能完全替代 CHECK 嗎？舉一個應用層守不住的場景。
- 為什麼這專案不用 PG ENUM 型別？
- CHECK 跟 NOT NULL 的差別？

---

## 第 08 課：JSONB 入門 — 何時該拆表、何時內嵌

**學習目標**：能對「新需求要加什麼資料結構」做出「拆表 vs JSONB」的判斷。

**內容**：
- 從最簡單的 `trips.weather_cities`（純字串陣列）入門
- 進階：`trips.todos` 物件陣列
- 看 `DATABASE.md §3` 開頭那三條判斷準則：
  1. 子實體不會被外部 query 拿來 aggregate
  2. 子實體是父實體私有屬性
  3. 子實體會跟著父實體一起變動
- 反例：為什麼 `expenses` 不能塞進 `trips.expenses` JSONB？因為要跨 trip 算結帳、要 join split。
- JSONB 查詢語法初步：
  - `trips.todos -> 0` 取陣列第一個
  - `trips.todos -> 0 ->> 'text'` 取欄位（`->>` 是回 text，`->` 是回 jsonb）
  - `jsonb_array_length(trips.todos)` 算長度
  - `jsonb_array_elements(trips.todos)` 攤平成 row

**動手練習**：
1. 用 SQL 找出「todo 數量 > 5」的所有 trip：
   ```sql
   SELECT id, title, jsonb_array_length(todos) AS n
   FROM trips
   WHERE jsonb_array_length(todos) > 5;
   ```
2. 用 `jsonb_array_elements` 攤平所有 trip 的 todo（參考 `DATABASE.md §附錄 7`）
3. 思考題：「加新功能：每個行程可以記錄『同行寵物名單』，每筆有 name、type、photo」 — 要拆表還是 JSONB？答完之後對照三條準則檢查。

**驗收問題**：
- 三條 JSONB 準則是哪三條？
- 為什麼 `trips.todos` 用 JSONB，但 `todos` 表又獨立存在？(複雜題：兩者的 source of truth 是什麼？)
- `->` 和 `->>` 差在哪？

---

## 第 09 課：時間與精度的坑

**學習目標**：能解釋「為什麼 trips.start_date 是 TEXT 但 expenses.expense_date 是 DATE」、知道金額為何不能用 FLOAT。

**內容**：
- 時間相關型別：
  - `TIMESTAMPTZ` — 帶時區的絕對時間點（提醒、寄信、稽核都用這個）
  - `TIMESTAMP` — 不帶時區（這專案不用，會有時區歧義）
  - `DATE` — 純日期（用於要排序、索引的場景，例如 `expenses.expense_date`）
  - `TEXT` — 字串日期（用於「使用者腦中的當地日期」，例如 `trips.start_date`，不需排序也不要時區轉換）
- 浮點數惡夢：
  ```sql
  SELECT 0.1::float + 0.2::float;          -- 0.30000000000000004
  SELECT 0.1::numeric + 0.2::numeric;       -- 0.3
  ```
- 為什麼 `expenses.amount_total` 是 `DECIMAL(14, 2)`、`exchange_rate` 是 `DECIMAL(18, 8)`
- Prisma 的 `Decimal` 物件，service 層怎麼用 `parseNumeric()` 序列化（指 `apps/api/src/modules/expenses/expenses.service.ts`）

**動手練習**：
1. 跑 `SELECT 0.1::float + 0.2::float;` 體驗誤差
2. 試把 `amount_total = 100.555` INSERT 進去，看 PG 怎麼處理（會 round 成 100.56 或 100.55，看版本）
3. 把使用者的時區設為 `+09:00`，INSERT `TIMESTAMPTZ '2026-05-01 08:00 +09:00'`，再用 `+00:00` 的 session 撈出來看是不是 `2026-04-30 23:00 UTC`

**驗收問題**：
- 為什麼 `trips.start_date` 不該是 `DATE`？（提示：跨時區用戶）
- 為什麼金額一定不能用 `FLOAT`？
- `TIMESTAMPTZ` 在 DB 裡實際存的是什麼？（提示：永遠是 UTC，TZ 只影響顯示）

---

## 第 10 課：從 Schema 到 Code — Prisma ORM

**學習目標**：能讀懂 `schema.prisma`、能寫基本的 Prisma 查詢取代 SQL。

**內容**：
- ORM 是什麼：把 SQL 表 ↔ TS 物件對映起來，省手寫 SQL
- 為什麼這專案選 Prisma：
  - 強型別 client（撈出來的物件型別自動推導）
  - migration 工具
  - 支援 raw SQL 當逃生口
- `schema.prisma` 三大區塊：
  - `generator client` — 產出 TS client
  - `datasource db` — 連線資訊
  - `model` — 對應每張表
- 對映慣例：
  - `@map("trip_id")` — DB 是 snake_case，Prisma client 是 camelCase
  - `@@map("trips")` — 表名對映
  - `@db.JsonB` / `@db.Uuid` / `@db.Timestamptz(6)` — 指定 PG 原生型別
- Prisma client 五招：
  ```ts
  prisma.trip.findMany({ where: { status: 'planning' } });
  prisma.trip.findUnique({ where: { id } });
  prisma.trip.create({ data: { title: '東京' } });
  prisma.trip.update({ where: { id }, data: { title: '大阪' } });
  prisma.trip.delete({ where: { id } });
  ```
- 進階一點：`include`（撈關聯）、`select`（只撈部分欄位）、`orderBy`、`take`/`skip`

**動手練習**：
1. 在 `apps/api` 裡寫一個 `scripts/scratch.ts`，用 Prisma client 撈所有 trip 印出來
2. 改成「撈出每個 trip 的 todo 數量」（用 `select: { id: true, title: true, todos: true }`，再用 JS 算 length）
3. 改寫成 raw SQL：`prisma.$queryRaw\`SELECT ...\`` 比較兩種寫法

**驗收問題**：
- `@map` 和 `@@map` 差在哪？
- Prisma client 怎麼知道 `trip.participants` 是 array？（看 schema 的 `TripParticipant[]`）
- 什麼時候該逃回 raw SQL？

---

## 第 11 課：Migration 工作流

**學習目標**：能正確改 schema、跑 migration、解釋 dev 跟 deploy 差別。

**內容**：
- 為什麼要 migration：DB 不像程式碼可以直接 git pull 重啟，必須漸進變更
- 看現有的 `prisma/migrations/` 資料夾，每個資料夾就是一次變更
- `prisma migrate dev` vs `prisma migrate deploy`：
  - `dev` — 本機用，會自動產出 SQL 檔、可能 reset DB
  - `deploy` — 線上用，只跑、不產生新檔、不會 reset
- 這專案的雙段式 migrate（看 `package.json` 的 `db:migrate`）：
  1. `prisma migrate deploy`（套 Prisma 產的 SQL）
  2. `tsx scripts/applyCheckConstraints.ts`（套 CHECK，因為 Prisma DSL 不支援）
- 改 CHECK 不需要產 migration：直接改 SQL 檔，腳本是 idempotent

**動手練習**：
1. 在 `Trip` 模型加一個欄位 `description String @default("")`，跑 `npm run db:generate -w @trip-planner/api`
2. 看新產出的 migration SQL，理解每一行
3. 試著手動 `psql` 改一個欄位後再 migrate → 觀察 Prisma 怎麼偵測到 schema drift
4. 把改動 revert（移除欄位）並產一個新的 migration，**不是回滾**舊 migration

**驗收問題**：
- 為什麼線上不該跑 `migrate dev`？
- 改 CHECK 為什麼不用產 migration？
- 「schema drift」是什麼？怎麼避免？

---

## 第 12 課：Seed 資料與本機環境

**學習目標**：能從零建起本機開發 DB（docker-compose up + migrate + seed）。

**內容**：
- 看 `docker-compose.yml` 的 postgres service：環境變數、ports、volume
- 看 `.env.example`，特別是 `DATABASE_URL` / `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`
- 看 `apps/api/src/db/seed.ts`：
  - 它讀什麼 env、怎麼建第一個 admin、用什麼 hash
  - 為什麼 seed 是 idempotent（重跑不會出問題）
- 完整流程演練：
  ```
  docker compose up -d postgres
  cp .env.example .env       # 填入 ADMIN_SEED_EMAIL/PASSWORD
  npm install
  npm run db:migrate -w @trip-planner/api
  npm run db:seed -w @trip-planner/api
  ```

**動手練習**：
1. 把整個 PG volume 砍掉（`docker compose down -v`）
2. 從零建起：up → migrate → seed
3. 用 seed 出來的 admin 帳號登入後台

**驗收問題**：
- seed 跑兩次會發生什麼事？怎麼設計才會 idempotent？
- 為什麼開發時不該把生產 DB 拿來當本機 DB？
- `docker compose down` 和 `docker compose down -v` 差在哪？

---

## 第 13 課（選修進階）：維運查詢與一致性檢查

**學習目標**：能用 SQL 抓出資料的潛在問題，學會「資料健檢」。

**內容**：
- 跑 `DATABASE.md §附錄` 的 8 條查詢，逐一講解：
  - jsonb_array_length 統計
  - split 總額一致性檢查
  - 找有提醒但 jobId 為 NULL 的 todo
  - 寄信失敗統計
  - 找孤兒資料
- 介紹 `EXPLAIN` 與 `EXPLAIN ANALYZE` 的差別
- 介紹 `pg_stat_statements`（如果環境有開）

**動手練習**：
1. 故意做一筆 expense，splits 加總跟 amount_total 差很多（例如總 100、splits 加總 90），跑查詢 #2 抓出來
2. 寫一個自己的「資料健檢」查詢：找出「沒有任何花費的行程」，建議使用者刪掉

**驗收問題**：
- 為什麼結帳數字（誰欠誰多少）不直接存資料庫？
- `EXPLAIN` 跟 `EXPLAIN ANALYZE` 差在哪？哪個會真的執行 query？
- 你會怎麼定期跑這些健檢？(寫一個 cron job 也行、人工每月跑一次也行)

---

## 階段結束時，學員應該能回答

1. 為什麼 trip-planner 用 PostgreSQL，不是 MongoDB？
2. 一個新需求進來：「行程要加上『預算上限』」，你會怎麼設計欄位？型別？要不要 CHECK？
3. 從 schema.prisma 走到資料真的進 DB，中間經過哪些步驟？
4. `expenses.payer_id` 用 RESTRICT 的設計理由？
5. 哪些東西用 JSONB、哪些用獨立表，背後的判斷依據是什麼？
6. 為什麼 `trips.start_date` 是 TEXT、`expenses.expense_date` 是 DATE？
7. 你怎麼確保 `expense.amount_total` 不會被存成負數？至少答出兩層防線。
8. 如果你改了 schema.prisma 的某個欄位，本機要跑哪些指令才會生效？

答得出全部 → 第一階段過關，可以進入第二階段（從 DB 一路串到 service / controller）。

---

## 教學者備忘

- **不要一次給太多**：第 8 課的 JSONB 是分水嶺，不熟的話第 13 課會跟不上。
- **錯誤訊息是好教材**：DB 拒絕你的時候會丟很清楚的錯（例如 `violates check constraint "expenses_amount_total_non_negative"`），帶學員讀錯誤訊息很值得。
- **建議在 `git tag` 標出每課對應的 commit**（例如 `lesson-04-relations`），讓學員卡住時可以 checkout 看標準狀態。
- **每課結束讓學員自己出一個問題**：能問出好問題，比答出問題更代表真的學會了。
