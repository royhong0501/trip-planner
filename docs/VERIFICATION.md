# 新 monorepo 上線前驗證

分三層：**docker compose** 服務活著、**pnpm dev** build 通、**使用者流程**端到端可用。每層的下一層失敗都可能是上一層沒跑起來，所以請依序往下。

## 1. Docker compose 服務

```bash
docker compose up -d
docker compose ps
```

確認看到：

| service | status | ports |
|---|---|---|
| `postgres` | healthy | `5432:5432` |
| `redis` | healthy | `6379:6379` |
| `minio` | healthy | `9000:9000`（S3 API）、`9001:9001`（console） |
| `minio-init` | exited 0 | — |

常見問題：

- `minio-init` 一直 restart：多半是 `S3_ACCESS_KEY`／`S3_SECRET_KEY` 和 MinIO 根憑證不一致。檢查 `.env`。
- Postgres 起不來：volume 已經是舊版資料 → `docker compose down -v` 砍掉重來（注意：會清 dev 資料）。

## 2. 初始化資料庫

```bash
pnpm install
pnpm db:migrate        # apps/api: drizzle-kit push to DATABASE_URL
pnpm db:seed           # 建立第一個 admin（讀 ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD）
```

驗證：

```bash
psql "$DATABASE_URL" -c "\dt"        # 應看到 trips / trip_participants / expenses / expense_splits / todos / admin_users / email_job_logs / homepage_settings
psql "$DATABASE_URL" -c "SELECT id, email FROM admin_users;"
```

## 3. Build / lint / test

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

全通過再繼續。local 開發時期若某些整合測試需要連 DB/Redis，務必確認 §1 已起。

## 4. 開發伺服器

```bash
pnpm dev
```

- API: `http://localhost:3000`
- Web: `http://localhost:5173`（vite dev server 把 `/api/*` proxy 到 3000）
- BullMQ worker: 與 API 同進程（`ensureReminderWorker()` 於 API 啟動時註冊），寄信前看 api server stdout。若你分開用 `pnpm --filter @trip-planner/api worker:reminder` 跑 stand-alone worker，請確認 API 那邊關閉對應的 worker，避免重複處理。

## 5. 端到端流程

### 5.1 後台登入 / 登出

1. 訪問 `/admin/login`，用 §2 `db:seed` 建立的帳密登入。
2. Devtools → Application → Cookies，應看到 `tp_admin` 的 httpOnly cookie，`Path=/`、`SameSite=Lax`。
3. 重新整理 `/admin/dashboard` 仍保持登入（`GET /api/auth/me` 200）。
4. 點右上登出，cookie 消失，重新訪問 dashboard 被導回 `/admin/login`。
5. 登入失敗 5 次以上：後端 `authLimiter` 會回 429，UI 顯示「登入嘗試次數過多」。

### 5.2 建立行程 + 上傳封面

1. Dashboard → 新增行程 → 填標題／日期／分類。
2. 封面：選一張 > 1MB 的 jpg。送出後觀察 Network：
   - `POST /api/uploads/cover` 200（payload 含 `uploadUrl`、`publicUrl`）
   - `PUT` 直接打到 MinIO（`localhost:9000`），200
3. 儲存 → `POST /api/trips` 201，回傳的 `coverImage` 應該是 `http://localhost:9000/trip-planner/...` 的 URL（不是 base64）。
4. 回列表頁，封面能顯示。

### 5.3 Todos（read-modify-write 正確性）

這是舊版有過 regression 的地方——「提醒寄出了但 todo 在編輯器裡不見」。驗證：

1. 打開行程編輯頁，加 3 個 todo，給第 2 個設一個 2 分鐘後的提醒。
2. 觀察 Network：`PATCH /api/trips/:id/todos` 200（body: `{ op: { type: 'add', todo: {...} } }`）。
3. 在同一頁用兩個分頁同時 toggle 不同 todo 的 checked：兩次請求都要成功，且最終狀態兩個 toggle 都生效（後端對 `trips.todos` 用 `SELECT ... FOR UPDATE`）。
4. 等 2 分鐘，提醒信寄到信箱。同時檢查 DB：
   ```sql
   SELECT id, text, is_notified FROM todos ORDER BY created_at DESC LIMIT 5;
   SELECT job_id, status, sent_at FROM email_job_logs ORDER BY created_at DESC LIMIT 5;
   ```
   對應 todo 的 `is_notified` 應為 `true`、`email_job_logs` 有一筆 status = `sent`。
5. 重新整理編輯頁：該 todo 仍然存在（沒有被 reminder 流程意外覆蓋）。

### 5.4 花費分帳 + 成員刪除阻擋

1. 行程內新增 2 名成員 A／B，建立一筆 expense，付款人 A、分帳 A 60 / B 40。
2. 試刪成員 A（被付款引用）：UI 應顯示「無法刪除（仍在分帳中）」，Network 上 `DELETE /api/participants/:id` 回 409。
3. 改建另一筆 expense 付款人 B，把 A 從分帳移除 → 再試刪 A 仍會 409（仍有其他地方引用）。
4. 全部相關 expense 刪掉後再刪 A → 成功，200/204。

### 5.5 天氣 proxy + Redis cache

1. 首頁或行程詳情頁加一個追蹤城市「Tokyo」。
2. 第一次查詢：`GET /api/weather/geocode?q=Tokyo` 200、`GET /api/weather?lat=...&lon=...` 200。
3. 30 秒內重新整理頁面：`GET /api/weather` 回應時間 < 20ms，且後端 log 顯示 cache hit（`weather:{lat}:{lon}:zh_tw`）。
4. `redis-cli` 檢查 key：
   ```
   KEYS weather:*
   TTL weather:35.6762:139.6503:zh_tw
   ```

### 5.6 首頁設定 / LOGO / 輪播

1. Dashboard → 首頁管理 → 改網站名稱、上傳 LOGO、加一張輪播圖，儲存。
2. `GET /api/homepage-settings/site_name`、`/site_logo`、`/carousel_slides` 三個 200。
3. 訪問 `/`（首頁），LOGO、名稱、輪播圖都看到新的（不要用快取，Ctrl+Shift+R）。

## 6. 上線前 smoke

- [ ] `pnpm -r build` 全部成功
- [ ] `apps/web/dist/` 可以 `pnpm --filter @trip-planner/web preview` 起得來，且同樣打到 `http://localhost:3000` 正常
- [ ] `apps/api` 在 production 模式跑（`NODE_ENV=production pnpm --filter @trip-planner/api start`），不再吐 Zod env 錯誤
- [ ] Brevo 的 API key 確認是 production 專用（不是 sandbox），寄一封實驗信
- [ ] JWT_SECRET 至少 32 bytes 的隨機字串，**不要**和 dev 同值
- [ ] 反向代理（nginx / Caddy）同 origin 服務 `/` → web dist 與 `/api/*` → 3000；這樣 `tp_admin` cookie 不需要 cross-site 設定

## 7. Rollback plan

前端 `apps/web/src/lib/supabase.ts` 目前是「任何呼叫就 throw」的 Proxy。若發現哪個角落還在用它：

1. stderr 會印 `` `supabase` is no longer available — replace this call with `api` from '@/lib/apiClient'. ``
2. 回頭修那支 call site 改用 api client，不要把 shim 還原成真的 Supabase client（會讓我們長期分叉）。
