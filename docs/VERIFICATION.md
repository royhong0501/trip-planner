# 上線前驗證 Checklist

> **適用對象**：第一次部署到新環境，或從 Express 5 切換到 Nest.js 後的回歸驗證。  
> **使用方式**：依序往下，**每一步驗證通過再進下一步**。下層失敗多半是上層沒跑起來。

分七層：
1. Docker compose 服務
2. 資料庫初始化 + seed
3. Build / typecheck / e2e tests
4. 開發伺服器啟動
5. 端到端使用者流程（5.1 - 5.6）
6. Production smoke
7. Rollback plan

---

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

進階驗證：

```bash
# Postgres
psql "$DATABASE_URL" -c "SELECT 1"

# Redis
redis-cli -u "$REDIS_URL" PING        # → PONG

# MinIO（建好的 bucket）
mc alias set local http://localhost:9000 $S3_ACCESS_KEY_ID $S3_SECRET_ACCESS_KEY
mc ls local/                           # 應看到 trip-planner（或 .env 設定的 bucket）
```

常見問題：

- `minio-init` 一直 restart：多半是 `S3_ACCESS_KEY_ID`／`S3_SECRET_ACCESS_KEY` 與 MinIO 根憑證不一致。檢查 `.env`。
- Postgres 起不來：volume 已是舊版資料 → `docker compose down -v` 砍掉重來（**注意：會清 dev 資料**）。
- Redis OOM：BullMQ 在 dev 留太多 completed jobs，用 `redis-cli FLUSHALL` 清掉（dev 環境）。

---

## 2. 初始化資料庫

```bash
npm install
# 本機第一次：互動建立 baseline migration
npm run db:generate -w @trip-planner/api

# 部署環境：套既有 migration + CHECK constraints
npm run db:migrate -w @trip-planner/api

# 建立第一個 admin（讀 ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD）
npm run db:seed -w @trip-planner/api
```

驗證：

```bash
psql "$DATABASE_URL" -c "\dt"
# 應看到 8 張表：trips / trip_participants / expenses / expense_splits /
#               todos / admin_users / email_job_logs / homepage_settings

psql "$DATABASE_URL" -c "SELECT id, email FROM admin_users;"
# 至少有一筆，否則無法登入後台
```

CHECK constraint 套用驗證（防止 `db:migrate` 漏跑 `applyCheckConstraints.ts`）：

```bash
psql "$DATABASE_URL" -c "\d+ trips" | grep -i check
# 應看到 trips_category_check / trips_status_check 等
```

---

## 3. Build / typecheck / e2e tests

```bash
# 所有 workspace
npm run typecheck --workspaces --if-present
npm run lint --workspaces --if-present
npm test --workspaces --if-present
npm run build --workspaces --if-present
```

或用 Turborepo（會用快取，重複跑很快）：

```bash
npx turbo run typecheck lint test build
```

### Nest.js API 專用驗證

```bash
# typecheck（最快的健康檢查）
npm run typecheck -w @trip-planner/api
# 預期：無輸出

# e2e tests（不需要 docker，使用 ioredis-mock + mockDeep<PrismaClient>）
npm test -w @trip-planner/api
# 預期：
#   Test Files  3 passed (3)
#   Tests       7 passed (7)
#
#   - test/health.e2e-spec.ts (1 test)        ← 煙霧測試 /health
#   - test/auth.e2e-spec.ts   (3 tests)       ← login/me/logout + 401 + 中文錯誤
#   - test/trips.e2e-spec.ts  (3 tests)       ← list / 401 / delete + cancel reminders
```

> **新增功能必補 e2e**：在 `apps/api/test/<feature>.e2e-spec.ts`，參考 `trips.e2e-spec.ts` 的樣板（用內嵌的 `MockReminderModule` + `overrideProvider(PrismaService)` 注入 mock）。
>
> **目前未覆蓋的 controller**（Phase 5 遺留，可漸進補上）：
> - admin-users（CRUD + 自殺刪除阻擋）
> - participants（add + ledger 阻擋刪除）
> - expenses（createWithSplits transaction）
> - todos（patchTodos + reminder 同步）
> - homepage（upsert）
> - weather（cache hit/miss + Throttler 429）
> - uploads（presigned URL 產出）

### Build 產出驗證

```bash
ls apps/api/dist/main.js                  # 應存在
ls apps/api/dist/app.module.js
ls apps/api/dist/workers/reminder.entry.js
ls apps/api/dist/modules/auth/auth.controller.js

# 試啟 production build（需 .env 與 docker 服務）
NODE_ENV=production node apps/api/dist/main.js
# 預期 stdout：[Nest] 12345 ... [Bootstrap] [api] listening on http://localhost:3000 (production)
```

---

## 4. 開發伺服器

```bash
# 同時跑（推薦）
npx turbo run dev

# 或分別
npm run dev -w @trip-planner/api      # http://localhost:3000
npm run dev -w @trip-planner/web      # http://localhost:5173
```

驗證 API 啟動：

```bash
curl -s http://localhost:3000/health | jq
# {
#   "status": "ok",
#   "env": "development",
#   "time": "2026-04-26T..."
# }
```

API stdout 應看到（Nest 預設 logger）：

```
[Nest] 12345 ... [InstanceLoader] AppConfigModule dependencies initialized
[Nest] 12345 ... [InstanceLoader] PrismaModule dependencies initialized
[Nest] 12345 ... [InstanceLoader] RedisModule dependencies initialized
[Nest] 12345 ... [InstanceLoader] AuthModule dependencies initialized
...
[Nest] 12345 ... [RoutesResolver] AuthController {/api/auth}
[Nest] 12345 ... [RouterExplorer] Mapped {/api/auth/login, POST} route
[Nest] 12345 ... [RouterExplorer] Mapped {/api/trips, GET} route
...
[Bootstrap] [api] listening on http://localhost:3000 (development)
```

### BullMQ Worker 啟動模式

兩種模式擇一：

**A. 內嵌（dev 預設）** — `.env` 設 `ENABLE_EMBEDDED_WORKER=true`（預設值）。API 程序內會註冊 `ReminderProcessor`，啟動時看到：

```
[Nest] ... [InstanceLoader] BullModule dependencies initialized
[Nest] ... [BullModule] Created queue: trip-reminders
```

**B. 獨立行程（生產推薦）** — `.env` 設 `ENABLE_EMBEDDED_WORKER=false`，另開 terminal：

```bash
npm run worker:reminder -w @trip-planner/api
# stdout: [Bootstrap] [worker:reminder] started
```

> **重要**：兩個都跑會造成同一個 job 被處理兩次（worker 競爭）。生產環境請只開其中一個。

---

## 5. 端到端使用者流程

依序測，每一個都該是 **happy path**。如果失敗，先看瀏覽器 Network、再看 API stdout、再看 docker logs。

### 5.1 後台登入 / 登出

1. 訪問 `http://localhost:5173/admin/login`，用 §2 `db:seed` 建立的帳密登入。
2. **Devtools → Application → Cookies**，應看到：
   - Name: `tp_admin`
   - Value: JWT（base64-ish）
   - HttpOnly: ✓
   - Path: `/`
   - SameSite: `Lax`
   - Secure: 開發為 `false`（生產 `true`，由 `COOKIE_SECURE` 或 `NODE_ENV=production` 觸發）
3. 重新整理 `/admin/dashboard` 仍保持登入：Network 應看到 `GET /api/auth/me` 200。
4. 點右上登出，cookie 消失（`Set-Cookie: tp_admin=; Max-Age=0`）；重新訪問 dashboard 被導回 `/admin/login`。
5. **登入失敗 21 次以上**：第 21 次起 `POST /api/auth/login` 應回 429 `{"error":"太多請求，請稍候再試"}`，UI 顯示對應提示。
   - 重置：等 15 分鐘 或 `redis-cli DEL "throttler:auth:::ffff:127.0.0.1"`（key 視 trust proxy 設定而定）。

### 5.2 建立行程 + 上傳封面

1. Dashboard → 新增行程 → 填標題／日期／分類。
2. 封面：選一張 > 1MB 的 jpg。儲存時觀察 Network：
   - `POST /api/uploads/cover` 200，回應應含：
     ```json
     {
       "key": "cover/2026-04-26/<uuid>.jpeg",
       "uploadUrl": "http://localhost:9000/...?X-Amz-Signature=...",
       "publicUrl": "http://localhost:9000/trip-planner/cover/2026-04-26/<uuid>.jpeg",
       "expiresIn": 300
     }
     ```
   - **緊接的** `PUT` 直接打到 MinIO（`localhost:9000`），200。前端**不會**把圖片透過 `apps/api` 中轉。
3. 儲存行程 → `POST /api/trips` 201，回傳的 `coverImage` 應該是 `http://localhost:9000/trip-planner/...` 完整 URL（不是 base64、不是空字串）。
4. 回列表頁，封面能顯示（不出現破圖）。

### 5.3 Todos（read-modify-write 正確性）

> 這是舊版有過 regression 的地方——「提醒寄出了但 todo 在編輯器裡不見」，因為兩個分頁同時儲存時用的是 stale 快照。Nest.js 版保留 `prisma.$transaction` + `SELECT ... FOR UPDATE` 鎖，務必驗證。

1. 打開行程編輯頁，加 3 個 todo，給第 2 個設一個 2 分鐘後的提醒。
2. 觀察 Network：`PATCH /api/trips/:id/todos` 200（body: `{ op: { type: 'add', todo: {...} } }` 或 `{ replace: [...] }`）。
3. **並發測試**：同一頁開兩個分頁同時 toggle 不同 todo 的 checked。
   - 兩次請求都要 200。
   - 重新整理後**最終狀態兩個 toggle 都生效**（這證明 `FOR UPDATE` 行鎖有效）。
4. 等 2 分鐘，提醒信寄到信箱。同時檢查 DB：
   ```sql
   SELECT id, task_name, is_notified, retry_count
     FROM todos ORDER BY created_at DESC LIMIT 5;

   SELECT triggered_at, total_found, sent_count, source, details
     FROM email_job_logs ORDER BY created_at DESC LIMIT 5;
   ```
   對應 todo 的 `is_notified` 應為 `true`、`email_job_logs` 有一筆 `source = 'bullmq'`、`details[0]->>'status' = 'sent'`。
5. 重新整理編輯頁：該 todo **仍然存在**（沒有被 reminder 流程意外覆蓋）。

### 5.4 花費分帳 + 成員刪除阻擋

1. 行程內新增 2 名成員 A／B，建立一筆 expense，付款人 A、分帳 A 60 / B 40。
   - Network: `POST /api/expenses` 201，回應含 `splits[0].owedAmount = 60`、`splits[1].owedAmount = 40`。
   - 驗證 transaction：DB `expenses` 與 `expense_splits` 都有對應 row，且 split 的 `expense_id` 指回 main row。
2. 試刪成員 A（被付款引用）：UI 應顯示「無法刪除（仍在分帳中）」，Network 上 `DELETE /api/participants/:id` 回 **409**：
   ```json
   { "error": "此成員仍有花費或分攤紀錄，無法刪除" }
   ```
3. 改建另一筆 expense 付款人 B，把 A 從分帳移除 → 再試刪 A 仍會 409（`expenses.payer_id` 仍引用 A 的第一筆）。
4. 全部相關 expense 刪掉後再刪 A → 成功，**204 No Content**。

### 5.5 天氣 proxy + Redis cache + 限流

1. 首頁或行程詳情頁加一個追蹤城市「Tokyo」。
2. 第一次查詢：
   - `GET /api/weather/geocode?q=Tokyo&limit=1` 200，命中 OpenWeather API（log 沒看到 cache hit）。
   - `GET /api/weather?lat=...&lon=...&lang=zh_tw` 200。
3. **30 秒內重新整理頁面**：`GET /api/weather` 回應時間 < 20ms。後端 stdout / log 顯示 cache hit。
4. `redis-cli` 檢查 key：
   ```bash
   redis-cli -u "$REDIS_URL" KEYS 'weather:*'
   redis-cli -u "$REDIS_URL" TTL 'weather:35.6762:139.6503:zh_tw'
   # 應看到 < 1800（30 分鐘 TTL）
   redis-cli -u "$REDIS_URL" KEYS 'geocode:*'
   ```
5. **限流測試**（生產環境再做，dev 太煩）：
   ```bash
   for i in $(seq 1 70); do curl -s -o /dev/null -w "%{http_code}\n" \
     "http://localhost:3000/api/weather/geocode?q=Tokyo&limit=1"; done | sort | uniq -c
   # 期望：60 個 200、10 個 429
   ```

### 5.6 首頁設定 / LOGO / 輪播

1. Dashboard → 首頁管理 → 改網站名稱、上傳 LOGO、加一張輪播圖、儲存。
2. Network 上應有 3 個 200：
   - `PATCH /api/homepage-settings/site_name`
   - `PATCH /api/homepage-settings/site_logo`
   - `PATCH /api/homepage-settings/carousel_slides`
3. 訪問 `/`（首頁），LOGO、名稱、輪播圖都看到新的（**強制重整**：Ctrl+Shift+R / Cmd+Shift+R，避免被前端 cache 騙）。

---

## 6. Production Smoke

正式上線前最後一輪。任何一項 fail 就**停止部署**。

### 6.1 編譯 / 啟動

- [ ] `npx turbo run build` 全部成功（或 `npm run build --workspaces --if-present`）。
- [ ] `apps/api/dist/main.js` 存在。
- [ ] `apps/web/dist/index.html` 存在，且 dist size 合理（首頁 < 500KB gzipped）。
- [ ] `apps/web` build 後可 `npm run preview -w @trip-planner/web` 起來，並且打到 `http://localhost:3000` 正常。
- [ ] `apps/api` 在 production 模式啟動：
  ```bash
  NODE_ENV=production npm run start -w @trip-planner/api
  ```
  - 不再吐 Zod env 錯誤（fail-fast）
  - stdout 看到 `[Bootstrap] [api] listening on http://localhost:3000 (production)`
  - 沒有 `[ERROR]` 等級的 log

### 6.2 安全 / 配置

- [ ] **`JWT_SECRET`** 至少 32 bytes 的隨機字串，**且與 dev 環境不同**。生成：`openssl rand -base64 48`
- [ ] **`COOKIE_SECURE=true`**（或 `NODE_ENV=production` 自動觸發），cookie 只走 HTTPS。
- [ ] **`COOKIE_DOMAIN`** 設成正確的 production 網域（若前後端 same-origin 可留空）。
- [ ] **`CORS_ORIGIN`** 不含 `localhost`、不含萬用字元，只放正式網域。
- [ ] **`BREVO_API_KEY`** 是 production 專用（不是 sandbox），並且寄一封實驗信確認 deliverability。
- [ ] **`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`** 在 production 用過一次後，從 secret manager 移除（避免日後 re-seed 把密碼覆蓋）。

### 6.3 路由 / 反向代理

- [ ] 反向代理（nginx / Caddy / Cloudflare）以 same-origin 服務 `/` → web dist 與 `/api/*` → 3000；這樣 `tp_admin` cookie 不需要 cross-site 設定。
- [ ] `/health` 從外部可達（用作 LB 健康檢查），但避免曝露其他資訊。
- [ ] HTTP → HTTPS 強制重導。
- [ ] 反向代理把 `X-Forwarded-For` / `X-Forwarded-Proto` 正確帶進去（API 已 `app.set('trust proxy', 1)`，否則 Throttler 抓的是 LB 後 IP，限流會擋全宇宙）。

### 6.4 BullMQ / Worker

- [ ] 決定 worker 模式：
  - 內嵌：API 多副本部署時要小心，每個 API 都會搶 job（`@nestjs/bullmq` 預設 concurrency=5），通常不是問題但要確認 Redis 的 connection 數夠用。
  - **獨立**（推薦生產）：`ENABLE_EMBEDDED_WORKER=false` 在 API；另跑 `npm run worker:reminder -w @trip-planner/api`（或對應 dist 路徑）的 process。
- [ ] 寄一封提醒信端到端：建一個 1 分鐘後的提醒 → 到時間後 `email_job_logs` 有 `status: 'sent'` 紀錄、信箱收到、`todos.is_notified = true`。
- [ ] 如果有舊資料，跑 `npm run -w @trip-planner/api exec -- tsx scripts/reseedReminders.ts` 把 pending 提醒重塞回佇列。

### 6.5 監控 / 告警

- [ ] API container 接到 log 收集（stdout / stderr）。
- [ ] Redis 有監控（記憶體、連線數）。BullMQ 在 Redis OOM 時會卡住，事先告警。
- [ ] Postgres 有監控（連線數、slow query log）。Prisma 預設連線池對應 worker 數，多副本部署時注意。
- [ ] Brevo 寄信失敗（`status: 'failed'`）的 `email_job_logs` 有定期掃描告警。

---

## 7. Rollback Plan

### 7.1 部署層 rollback

- 反向代理切回舊版本的 backend port 或 image tag。
- 資料庫 migration **不要回滾**（向下不相容）。Prisma 的 migration 是順向的；如果新版 migration 改了 column 型別，先用舊 schema 試讀，必要時手動加 default。

### 7.2 框架層（Express → Nest.js）rollback

如果 Nest.js 版上線後發現嚴重 bug 而需要快速回退到 Express：

```bash
git revert <merge-commit-sha>     # 或：git checkout <pre-migration-tag>
npm install                        # 重新拉舊依賴
npm run db:generate -w @trip-planner/api  # 通常 Prisma schema 沒動，不用跑
npm run build -w @trip-planner/api
NODE_ENV=production npm run start -w @trip-planner/api
```

**對外契約零變更**意味著前端 `apps/web` 與 `packages/api-client` 不需要改，回退單向。

### 7.3 Supabase shim 提醒

前端 `apps/web/src/lib/supabase.ts` 是「任何呼叫就 throw」的 Proxy。若發現哪個角落還在用它：

1. stderr 會印 `` `supabase` is no longer available — replace this call with `api` from '@/lib/apiClient'. ``
2. 回頭修那支 call site 改用 api client，**不要把 shim 還原成真的 Supabase client**（會讓我們長期分叉）。

---

## 8. 偏門檢查（半年一次）

- [ ] `email_job_logs` 表大小：超過 1GB 就建 partition by `triggered_at`，或定期清舊資料。
- [ ] BullMQ `failed` queue 不應持續累積，超過 100 件去檢查 Brevo 配額或 SMTP 認證。
- [ ] `prisma migrate status` 與 git 上的 migration 一致（避免有人在 prod 手動跑了 SQL）。
- [ ] `node_modules` 裡 `@nestjs/*` 跨子套件版本一致（`npm ls @nestjs/common`）；不一致會出現 reflect-metadata 怪錯誤。
- [ ] Redis 的 `revoked_jti:*` keys 不應無上限增長（TTL 應與 JWT_ACCESS_TTL 同步），用 `redis-cli --scan --pattern 'revoked_jti:*' | wc -l` 抽查。
