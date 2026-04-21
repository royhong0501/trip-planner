# 從 Supabase 搬到自架 Postgres

這份文件記錄把舊版 `trip-planner-buddy-50-main`（Supabase 專案）的資料搬到本 monorepo 自架 Postgres 的步驟。包含欄位對應、RLS 清理、storage 物件遷移、以及驗證查詢。

## 1. 事前準備

- 本機已能執行 `docker compose up`（Postgres / Redis / MinIO 會啟動）。
- 已在 `.env` 填好 `DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`S3_*`、`BREVO_API_KEY`、`OPENWEATHER_API_KEY`。
- 舊 Supabase 專案：取得 **Project Settings → Database → Connection string**（注意：搬資料請用「Session mode」的直連字串，不要用 pgbouncer 6543 port）。
- 安裝 `pg_dump` ≥ 16（對應本地 Postgres 版本）與 `mc`（MinIO client）。

## 2. 匯出 Supabase schema + data

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

> `--no-owner --no-privileges` 可以避免把 Supabase 專屬的 role (`postgres`、`authenticated`、`anon`、`service_role`) 一起帶過來。
>
> `--disable-triggers` 在匯入 data 時會暫時關掉 FK check，避免按子表先於母表插入而 fail。

## 3. 清掉 RLS 與 Supabase 專屬物件

舊 `public` schema 裡塞了 Supabase 的 policy、trigger、RLS 開關，新 Postgres 不需要。匯入前對 `old-public-schema.sql` 做一次 sed 過濾：

```bash
# 移除所有 CREATE POLICY / ALTER TABLE ... ENABLE ROW LEVEL SECURITY
grep -Ev '^(CREATE POLICY|ALTER TABLE .+ (ENABLE|DISABLE|FORCE) ROW LEVEL SECURITY|COMMENT ON POLICY|GRANT|REVOKE)' \
  old-public-schema.sql > old-public-schema.clean.sql
```

檢查 `old-public-schema.clean.sql` 是否還有下列要人工處理的項目：

- `CREATE EXTENSION` → 只保留 `pgcrypto`（for `gen_random_uuid()`）、`uuid-ossp`；其他（`vault`、`pgjwt`、`pg_graphql`…）刪掉。
- 參照 `auth.users` 的 FK → 這裡 `admin_users` 由我們自己的表取代，舊資料只搬 `trip_participants.user_id` 即可（可保留或清為 NULL）。
- 任何 `EXECUTE FUNCTION public.create_expense_with_splits(...)` 的 RPC 定義 → 刪掉，後端已改用 Drizzle transaction。

## 4. 建立新 DB 結構

**不要直接套用清理後的舊 schema**——新 monorepo 用 Drizzle 管結構，欄位型別和 constraint 已經微調（例如 `numeric(14,2)` / `numeric(18,8)`、check constraint、`ON DELETE RESTRICT` for `payerId`）。

```bash
pnpm db:migrate     # drizzle-kit push
pnpm db:seed        # 建立第一個 admin 帳號（用 ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD）
```

## 5. 匯入舊資料

新 schema 已建好，只需倒入 `old-public-data.sql` 的 `COPY ... FROM stdin;` 段落。因為欄位名幾乎一致（都是 snake_case），大多數表直接 `\i` 就能進來：

```bash
psql "$NEW_DB_URL" -f old-public-data.sql
```

若遇到下列錯誤，對應處理：

| 錯誤 | 原因 | 處理 |
|------|------|------|
| `relation "auth.users" does not exist` | 舊 data 有 FK 到 Supabase `auth.users` | 匯入前先 `psql -c "ALTER TABLE trip_participants DROP CONSTRAINT IF EXISTS trip_participants_user_id_fkey;"` |
| `invalid input syntax for type numeric` | `amount_total` 來源是 `numeric` 無 scale 限制 | 已手動 `ROUND` 一次再匯入，或直接讓 Postgres 轉型（14,2 會四捨五入） |
| `column "job_id" of relation "todos" does not exist` | 舊版沒有 BullMQ 對應欄位 | 正常。新欄位在 Drizzle migration 中就是 `NULL`，匯入後現有提醒自動重新排程（見 §7） |
| `violates check constraint "trips_category_check"` | 舊資料可能有空字串 | `UPDATE trips SET category = 'international' WHERE category = '';` 再重試 |

## 6. Storage（封面圖、首頁影片、LOGO、輪播）

舊專案用 Supabase Storage 的 `homepage-media` bucket。新環境用 MinIO。

```bash
# 1) 把舊 bucket 整包 sync 下來
npx supabase storage list-objects --bucket homepage-media > obj-list.txt
# （或用 Supabase Dashboard → Storage → 下載全部）

# 2) 上傳到本地 MinIO
mc alias set local http://localhost:9000 $S3_ACCESS_KEY $S3_SECRET_KEY
mc cp --recursive ./homepage-media-dump/ local/trip-planner/
```

接著把 DB 裡的舊 URL 批次改寫成新的 `PUBLIC_S3_URL`：

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

> 沒搬 storage 的話也不會壞：前端仍會顯示舊 Supabase 的公開 URL（直到該專案被暫停）。但建議一次搬乾淨。

## 7. 重建 BullMQ 提醒排程

舊版提醒由 Supabase Cron + Edge Function 依 `todos.remind_time` 檢查觸發。新版用 BullMQ，每筆提醒要有對應的 delayed job 才會寄信。

```bash
pnpm --filter @trip-planner/api exec tsx scripts/reseedReminders.ts
```

這支 script 掃描 `todos` 表，對 `remind_time > now()` 且 `is_notified = false` 的每一筆呼叫 `enqueueReminder(...)`，把 jobId 寫回 `todos.job_id`。

> 第一次搬完後在 BullMQ dashboard (若有開) 看到 `trip-reminders` queue 有對應數量的 delayed job 即代表成功。

## 8. 驗證 checklist

匯完資料後，依序跑這些查詢，確認沒掉行：

```sql
-- 行程數
SELECT COUNT(*) FROM trips;

-- 每個 trip 的 todos 數（抓 JSONB array length）
SELECT id, jsonb_array_length(todos) FROM trips ORDER BY id LIMIT 5;

-- 花費主檔 + 分帳一致性（每筆 expense 的 split 總和應該等於 amount_total * exchange_rate 或自行約定）
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
-- 期望 0；若 > 0，回到 §7 重新執行 reseedReminders
```

UI 端驗證：

- `/` 首頁輪播、LOGO、Intro 影片能載入。
- 後台登入（`/admin/login`）用 §4 `db:seed` 建立的密碼進得去。
- 行程列表不會 OOM（舊資料的 `daily_itineraries` 內嵌 base64 大圖時特別注意；list 頁已改走 summary API，不應該回傳這些欄位）。
- 編輯一個行程，改個 todo 按儲存 → server log 看到 `PATCH /api/trips/:id/todos`、DB 實際有更新（對同一 todo 再打一次 toggle 不應該出現 legacy 的「reminder 已寄但 todo 不見」問題）。
- 設一個 1–2 分鐘後的提醒 → 時間到 Brevo / `email_job_logs` 有對應紀錄。

## 9. 退場（Supabase 專案停用）

確認以上 8 項都 OK、觀察數天沒問題後：

1. Supabase → Project Settings → **Pause project**（先 pause，不要直接 delete，留 7 天回滾空間）。
2. 前端 `.env` 徹底移除 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（本專案已經不用，但舊 CI / 部署環境要一併清）。
3. 一週後 Supabase 專案 delete；同時刪掉 `apps/web/src/lib/supabase.ts` 這支「拋錯的 Proxy shim」—— 現在留著是為了讓任何漏改的呼叫以顯性 runtime error 出現（比靜默成功安全）。
