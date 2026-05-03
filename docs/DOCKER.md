# Docker 化設計與學習筆記

> **目的**：記錄這個專案怎麼從「postgres/redis/minio 在 docker，api/web 在 host」變成「全部容器化」的過程，包含設計考量、踩過的坑、跟可以類推到其他專案的觀念。
> **適用對象**：你（之後改設定時不踩同樣坑）、未來來接手的人。

---

## 0. 前情提要

改造前：

```
docker-compose.yml  →  postgres + redis + minio + minio-init   ✅ 容器化
host:                  npm run dev (api on 3000, web on 5173)  ❌ 沒容器化
```

改造後：

```
docker-compose.yml  →  postgres + redis + minio + minio-init
                       + api + web                              ✅ 全容器化
                       + db-init (--profile init)               ✅ 一次性初始化
```

新增/修改檔案：

| 檔案 | 動作 | 角色 |
|---|---|---|
| `.dockerignore` | 新增 | 控制 build context；缺它就會洩 secrets / 慢 |
| `apps/api/Dockerfile` | 新增 | api 多階段 image |
| `apps/web/Dockerfile` | 新增 | web 多階段 image |
| `docker-compose.yml` | 改寫 | 加入 api、web、db-init 三個 service |
| `apps/web/vite.config.ts` | 修改 | 拆出 `VITE_DEV_PROXY_TARGET` 解決容器內 proxy 與瀏覽器 base URL 的衝突 |
| `apps/api/package.json` | 修改 | dev 腳本從 `tsx watch` 改成 SWC + `node --watch`（修 DI metadata bug） |

---

## 1. 整體策略

### 1.1 為什麼一個 app 一個 Dockerfile

api（Node + Prisma engine）跟 web（最終跑 nginx 提供靜態檔）的 base image 不同、build 工具不同、最終 runtime 不同。塞同一個 Dockerfile 會出現一堆 `if`，read 不懂、cache 命中率也差。**「同一個 image 服務不同職責」是反 pattern**；分開反而簡單。

### 1.2 為什麼一個 Dockerfile 內多 stage（base → deps → dev → build → prod）

替代方案是 `Dockerfile.dev` + `Dockerfile.prod`。多 target 的好處：

- 共用 `deps` 層，依賴只裝一次。
- 切換 dev/prod 只改 compose 的 `target:`，沒有兩份檔案漂移的風險。
- `docker build --target dev .` 可以單獨打 dev image，`--target prod` 同理。

### 1.3 為什麼資料服務不發佈 host port、應用服務發佈

| 服務 | host port 發佈 | 原因 |
|---|---|---|
| postgres | ❌ | api 走 docker 內網 `postgres:5432`；發佈反而碰到 host 端 PostgreSQL 服務衝突 |
| redis | ❌ | 同上；Windows 上常有 Memurai 占 6379 |
| minio API (9000) | ✅ | `S3_PUBLIC_BASE_URL` 寫進 presigned URL 給瀏覽器，瀏覽器跑在 host |
| minio Console (9001) | ✅ | 你開瀏覽器看的管理介面 |
| api (3000) | ✅ via `${API_PORT}` | 你 host 端 curl / 開發工具會用 |
| web (5173) | ✅ | 你開瀏覽器訪問 |

**原則**：「容器之間的溝通」不需要 `ports:`，只有「host → 容器」才需要。

### 1.4 dev 模式 vs prod 模式

| | dev (compose `target: dev`) | prod (compose `target: prod`) |
|---|---|---|
| api source 怎麼進容器 | bind mount `.:/workspace` | `COPY` 進 image，固定 |
| 啟動命令 | `npm run dev`（SWC + `node --watch`） | `node dist/main.js` |
| node_modules | named volume 蓋過 host bind mount | 從 build stage 直接 `COPY` 過來 |
| 改 source code | 自動熱重載 | 要重 build image |
| image 大小 | 大（含 dev 套件） | 小（只剩 runtime） |

目前 compose 設定只用 dev target；prod target 寫在 Dockerfile 是預埋。

---

## 2. `.dockerignore` 為什麼要先寫

`docker build` 第一步是把整個 build context 打包送進 daemon。沒 `.dockerignore`：

- `.env`（含 JWT secret、API key）會被打包，後續任何 `COPY . .` 不慎就燒進 image layer 永久存在。
- `node_modules/`（幾百 MB）每次重傳。
- `pgdata/`、`minio-data/`、`redisdata/`（資料 volume 在 repo 內）會把 GB 級資料當成 build context 送進 daemon。
- `.git/` 整個 history 沒理由進 container。

**口訣：先寫 `.dockerignore`，再寫 `Dockerfile`**。順序顛倒幾乎一定洩東西。

關鍵幾條：

```
node_modules
**/node_modules     # 連子 workspace 也排
dist, build, .turbo # 都是輸出物
.env, **/.env       # 絕不進 image
pgdata, redisdata, minio-data
.git
```

---

## 3. `apps/api/Dockerfile` stage by stage

```dockerfile
FROM node:20-bookworm-slim AS base
```

**為什麼用 `bookworm-slim` 不用 `alpine`**：Prisma 5 在 alpine 需要 `linux-musl-openssl-3.0.x` engine，要在 `schema.prisma` 加 `binaryTargets`。少設一個就 runtime crash。Debian slim 用標準 `linux-glibc`，Prisma 預設支援，省掉很多除錯，多 50 MB 而已。

```dockerfile
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/*/package.json ...
COPY apps/api/prisma ./apps/api/prisma
RUN npm ci
```

**為什麼分這麼多 COPY 而不直接 `COPY . .`**：

Docker layer cache 只要這層的輸入沒變，就不重跑。
- 只 COPY manifest 與 lock：source code 改動不會 invalidate `npm ci`，只有 deps 真的變才會重裝。
- 反例：`COPY . . && npm ci` — 改任何一行 source 就重跑 `npm ci`，每次 1–5 分鐘。

**為什麼還要 COPY `apps/api/prisma`**：因為 `apps/api/package.json` 有 `"postinstall": "prisma generate"`，要讀 schema。沒提早 COPY 進來，`npm ci` 在 postinstall 階段炸。

**為什麼 `npm ci` 不 `npm install`**：
- `ci` 嚴格依 lockfile，不偷偷升級 → 容器跟 host 版本一致。
- `ci` 每次砍掉重灌，沒舊版殘留。

```dockerfile
FROM deps AS dev
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3000
WORKDIR /workspace/apps/api
CMD ["npm", "run", "dev"]
```

**為什麼沒有 `COPY . .`**：故意的。dev 模式 source 走 bind mount（compose 那層做的），image 不放 source。否則改 code 還要重 build 才看得到，違背 dev 流程。

**為什麼要 `CHOKIDAR_USEPOLLING=true`**：你的開發機是 Windows，bind mount 跨 VM 邊界，inotify 事件**不會**穿到容器（Docker for Desktop 的著名痛點）。chokidar 改成 polling（每秒輪詢檔案 mtime）才能正確熱重載。`tsx`、`vite`、`node --watch` 都直接或間接用 chokidar，吃同一個 env var。

`prod` 與 `build` target 暫時是預埋；目前 compose 只跑 dev。

---

## 4. `apps/web/Dockerfile` 重點

跟 api 結構一樣（`base/deps/dev/build/prod`），差在：

- **dev CMD**：`npx vite --host 0.0.0.0 --port 5173`。`--host 0.0.0.0` 是為了讓容器外的瀏覽器連得到，否則 vite 預設只 listen 127.0.0.1，容器外打不進來。
- **prod 用 nginx**：生產環境前端只是一堆靜態 HTML/JS/CSS，沒理由用 Node 提供服務。`nginx:alpine` + SPA fallback (`try_files $uri /index.html;`) 處理 React Router 重整 404。
- **deps 階段也 COPY `apps/api/prisma`**：因為 npm workspaces 是「整個 monorepo 一起裝」，api 的 postinstall 一樣會跑，即使我只 build web。

---

## 5. `docker-compose.yml` 設計重點

### 5.1 `depends_on` 要帶 condition

```yaml
api:
  depends_on:
    postgres: { condition: service_healthy }
    redis:    { condition: service_healthy }
    minio:    { condition: service_healthy }
```

只寫 `depends_on: [postgres]` 只保證**容器**啟動，但 postgres process 可能還在初始化資料目錄、還沒接受連線。api 一上來連 DB 就 ECONNREFUSED → restart loop。

加 `condition: service_healthy` 後，compose 會等到對方 `healthcheck` 報 healthy 才繼續。所以 postgres / redis / minio 三個都有 `healthcheck:` — 缺一個 condition 就退化成「啟動就走」。

### 5.2 環境變數的「主機形式 vs 容器內形式」

`.env.example` 預設是給**主機端 `npm run dev`** 看的：

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/trip_planner
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
```

容器內沒有 `localhost` 對應 postgres — `localhost` 是容器自己。容器之間靠 compose 自動建立的 DNS（service name）通訊。所以 compose 在 `environment:` 蓋掉它們：

```yaml
api:
  env_file: [.env]              # 先讀 .env 全部變數
  environment:                  # 再覆蓋容器專用的
    DATABASE_URL: postgres://...@postgres:5432/...
    REDIS_URL:    redis://redis:6379
    S3_ENDPOINT:  http://minio:9000
    # S3_PUBLIC_BASE_URL 故意不蓋 — 它寫進 presigned URL 給瀏覽器，瀏覽器跑在 host
    CORS_ORIGIN:  http://localhost:5173
```

**載入順序很關鍵**：先讀 `env_file:`，再用 `environment:` 覆蓋同名值。所以 `JWT_SECRET` / `BREVO_API_KEY` 沒列在 environment 的，就直接從 `.env` 取。

> **`S3_PUBLIC_BASE_URL` 為什麼不蓋**：它最終會嵌進 presigned URL 回傳給瀏覽器讓使用者下載/上傳檔案。瀏覽器跑在 host，看不到 docker 內網的 `minio` 名字。這是「server-to-server URL」跟「server-to-browser URL」是兩件事的典型例子。

### 5.3 named volume 蓋掉 `node_modules`

```yaml
api:
  volumes:
    - .:/workspace                              # host source bind mount
    - api_node_modules:/workspace/node_modules  # 蓋掉 node_modules
```

**為什麼一定要這層**：host 上 `node_modules/.prisma/client/` 含 `query_engine-windows.dll.node`（Windows binary）。如果只有 `.:/workspace` 沒蓋 node_modules，Linux 容器會去載這個 `.dll.node` → load 失敗 crash。

named volume 的行為：在 bind mount 之上**疊一層**擋掉這個子路徑，docker 自己管。容器內 `npm ci` 跑出來的是 Linux binary 寫進 named volume；host 看不到、host 的 binary 也進不來，互不污染。

> **副作用**：你 host 上 `npm install` 新增的套件**容器看不到**。要嘛 `docker compose exec api npm install <pkg>`（在容器內裝），要嘛 `docker compose build --no-cache api` 重 build deps 層。

### 5.4 `vite.config.ts` 的 `VITE_DEV_PROXY_TARGET`

原本 vite.config.ts 用 `VITE_API_BASE_URL` 同時當：
- (a) Vite dev server 的 `/api` proxy target（server 端）
- (b) 透過 `import.meta.env` 暴露給瀏覽器（client 端）

容器化後這兩個值會打架：
- proxy target = `http://api:3000`（docker 內網才解析得到）
- 瀏覽器的 base URL = 不能設成 `http://api:3000`（瀏覽器在 host 解不到 `api` 名字）

修法：`vite.config.ts` 拆出第三個 env：

```ts
const apiBaseUrl =
  (env.VITE_DEV_PROXY_TARGET ?? '').trim() ||  // server-only
  (env.VITE_API_BASE_URL ?? '').trim() ||      // 相容 host workflow
  'http://localhost:3000';
```

compose 只設 `VITE_DEV_PROXY_TARGET=http://api:3000`，不設 `VITE_API_BASE_URL`，瀏覽器端 `apiClient.ts` 走 `window.location.origin` fallback（瀏覽器打 `localhost:5173/api/*`，Vite proxy 在 server 端轉到 api 容器）。

### 5.5 `db-init` 用 profile 隔離

```yaml
db-init:
  profiles: ["init"]
  entrypoint: >
    /bin/sh -c "
    npx prisma db push --skip-generate &&
    npx tsx scripts/applyCheckConstraints.ts &&
    npx tsx src/db/seed.ts
    "
```

- `profiles: ["init"]` 預設不啟動，要 `--profile init` 才現身。為什麼？因為它會改 DB schema，當 default service 的話每次 `up` 都重跑、跟 migration 概念衝突。
- 用 `prisma db push` 而非 `migrate deploy`：目前 `prisma/migrations/` 不存在，`migrate deploy` 是 no-op；`db push` 直接同步 schema。等你開始用 `prisma migrate dev` 累積 migration，這裡要改成 `migrate deploy`。
- `--skip-generate`：image build 已經 generate 過，不必重跑。

---

## 6. 踩過的坑（按發生順序）

### 6.1 殘留容器網路 ID

**症狀**：`docker compose --profile init up db-init` 報 `network ... not found`。

**原因**：`docker compose down` 預設不清 profile service 的容器。`down` 砍掉專案網路，但 `db-init` 容器還記著被砍掉的網路 ID。再 `up` 時 docker 想接回那個網路 → 找不到。

**修法**：
```powershell
docker compose --profile init rm -f db-init
docker compose --profile init up db-init
```

**長期教訓**：有 profile service 的專案，`down` 要記得帶 `--profile <name>`，否則會留孤兒。

### 6.2 host 上的 stale 容器網路不對

**症狀**：先用舊 compose 起了 postgres/redis/minio，後來改 compose 加 api/web，`docker compose --profile init up db-init` 報 `Can't reach database server at postgres:5432`。

**原因**：`docker compose ps` 顯示 `5432/tcp`（沒有 `0.0.0.0:5432->5432`），代表 postgres 是用**舊版 compose** 啟動的容器，掛在舊網路。新 db-init 加入新網路，DNS 解不到 `postgres`。

**修法**：`docker compose down` 一次砍掉所有 service + 網路，再 `up`。`down` **不**刪 named volume / bind mount，pgdata 安全。

**長期教訓**：compose 改設定後先 `down` 再 `up`，不要假設「容器已在跑就直接重用」。

### 6.3 redis 6379 port 已占用

**症狀**：`docker compose up -d` 報 `Bind for 0.0.0.0:6379 failed: port is already allocated`。

**原因**：host 上有 Memurai / Redis Windows service 占用 6379。

**修法**：原本 compose 寫 `ports: - "6379:6379"` 是為了讓 host 端工具連得到 redis；但 dev 期 api 已經在容器內，不需要。改用 `expose:` 只標記容器內可見，不發佈到 host。同理 postgres 5432。

**長期教訓**：dev 環境的資料服務「**預設不發佈 port 給 host**」是穩健做法。要 host 端用 `psql` / `redis-cli` 時再加 `docker-compose.override.yml`。

### 6.4 Windows excluded port range（卡 3000 / 3100）

**症狀**：`Bind for 0.0.0.0:3000 failed: bind: An attempt was made to access a socket in a way forbidden by its access permissions`。

**注意**：這跟「port already in use」是**不同的錯誤訊息**：
- `address already in use` → 真有人占
- `forbidden by its access permissions` → 被 Windows 預留圈走了

**原因**：Hyper-V / WSL2 / Docker Desktop 開機時會跟 Windows 申請一段 TCP port 預留範圍（excluded port range）。我這台機器拿到 2944–3643 整段（700 個 port），3000 / 3100 都中。**任何**程式想 listen 那段都會被擋。

查預留範圍：
```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
```

**修法**：`.env` 加 `API_PORT=4000`（或任何不在範圍內的 port，常見安全 port：4000、7000、8000、8081、9090；避開 5357、27339、50000–50059 那種單點預留）。compose 原本就寫 `${API_PORT:-3000}:3000`，host 端改 4000，**容器內依舊監聽 3000**，CORS / proxy / 端到端都不用改。

**長期教訓**：
- 看到 `forbidden by its access permissions` 別去找誰占了 port，先查 excluded range。
- 對外的 port 一律設計成可變數（`${VAR:-default}:internal`），這種事 5 秒解決。

### 6.5 NestJS DI 失敗：`tripsService is undefined`

**症狀**：api 啟動沒 error，`/health` 通，但 `/api/trips` 回 500：
```
TypeError: Cannot read properties of undefined (reading 'list')
    at TripsController.list (src/modules/trips/trips.controller.ts:39:30)
```

**追兇過程**：
1. 看 controller：`return this.tripsService.list();` → `this.tripsService` 是 undefined。
2. 看 module：`providers: [TripsService]` 有寫，沒漏。
3. 看 startup log：`[InstanceLoader] TripsModule dependencies initialized` 沒抱怨。
4. 對比能跑的 controller：`HealthController` 用 `@Inject(APP_CONFIG)` **顯式 token**；壞掉的 `TripsController` 用 `private readonly tripsService: TripsService` **靠型別自動注入**。
5. 看 `apps/api/dist/modules/trips/trips.controller.js`（tsc 編出來的）— 有 `__metadata("design:paramtypes", [TripsService, ReminderQueueService])`。
6. **結論**：`tsx watch` 走 esbuild 即時轉譯，雖然 tsconfig 設了 `emitDecoratorMetadata: true`，但 esbuild 的這個功能不可靠。沒了 `design:paramtypes`，NestJS 不知道要塞哪個 provider，就用 `undefined` 當參數靜默通過。

**修法**：改用 SWC 當 dev 載入器（NestJS 官方推薦）：

```bash
docker compose exec api npm install --save-dev --workspace=@trip-planner/api @swc-node/register
```

`apps/api/package.json`：
```diff
- "dev": "tsx watch src/main.ts"
+ "dev": "node --import @swc-node/register/esm-register --watch src/main.ts"
```

`apps/api/Dockerfile` dev target：
```diff
- CMD ["npx", "tsx", "watch", "src/main.ts"]
+ CMD ["npm", "run", "dev"]
```

SWC 跟 tsc 一樣會 emit `design:paramtypes`，且比 tsc 快十倍。`node --watch` 是 Node 20 內建的 watch 模式，不需 nodemon。

> **這 bug 在 host 端 `npm run dev` 也存在**，不是 docker 引入的；只是過去沒人打過 `/api/trips` 從 dev server 而沒被注意到。production 模式跑 `node dist/main.js` 沒事，因為 dist 是 tsc 編的。

**長期教訓**：
- NestJS + tsx 是已知踩雷組合，dev runner 一律用 SWC（或 `nest start --watch`）。
- 看到 `Cannot read properties of undefined` 在 controller 第一行，先懷疑 DI metadata，不是業務邏輯。
- 區分「能跑的 controller」和「不能跑的 controller」的最小差異 —— 用 `@Inject(token)` vs 靠型別 — 是診斷關鍵。

### 6.6 前端 import 死路徑（空白頁）

**症狀**：瀏覽器訪問 `localhost:5173` 完全空白。

**追兇過程**：
1. server 端：`curl http://localhost:5173/` 回完整 HTML 200 OK；`/src/main.tsx`、`/src/App.tsx`、`/src/index.css` 都 200。
2. vite log 沒 error。
3. 請使用者按 F12 看 console → `TripWeatherSidebar.tsx:6 Uncaught SyntaxError: The requested module '/src/lib/weather.ts' does not provide an export named 'getWeatherApiKey'`
4. 看 `weather.ts` 檔頭：`Requests now go through our backend ... the server holds the API key` — 之前重構把 OpenWeather key 從瀏覽器搬到 server，舊函式 `getWeatherApiKey()` 連同 export 一起被刪了，但 `TripWeatherSidebar.tsx` 還在 import 它。
5. **ESM 特性**：任何 import 失敗會中止整個 module graph，連 `createRoot()` 都跑不到，瀏覽器看到的是空白 root（HTML 載入了但沒 React render）。

**修法**：
- `apps/web/src/components/trip/TripWeatherSidebar.tsx:6` 拿掉 `getWeatherApiKey,`
- `:34` 改 `const hasKey = true;`（key 在 server，瀏覽器無從探測）

**長期教訓**：
- 空白頁 90% 是「JS bundle 早期失敗」，先看 browser console 不是 React 邏輯。
- 重構搬遷 API key 之類的「責任邊界轉移」要連同 caller 一起清，否則留下 dead import → ESM syntax error。

---

## 7. 日常指令速查

```bash
# 起服務
docker compose up -d                          # 全部
docker compose up -d api web                  # 只起 app
docker compose up -d --build api              # 改 Dockerfile 後重 build

# 看狀態 / log
docker compose ps
docker compose logs -f api
docker compose logs --tail=100 web

# 進容器除錯
docker compose exec api sh
docker compose exec api npm install <pkg>     # 在容器內裝套件
docker compose exec api npx prisma studio     # 開 Prisma Studio

# 一次性任務
docker compose --profile init rm -f db-init
docker compose --profile init up db-init      # schema push + seed

# 停服務
docker compose down                           # 留資料
docker compose down -v                        # 連 named volume 都清（pgdata 等 bind mount 仍保留）
docker compose --profile init down            # 含 profile service

# 重新建 image（依賴變了之後）
docker compose build --no-cache api
```

---

## 8. 後續可改進

- [ ] 把目前 `prisma db push` 改成 `prisma migrate deploy`，需要先建立 migration 目錄（`prisma migrate dev` 一次）並把 migration 進版控。
- [ ] `pgdata` 改成 named volume（與 redisdata、minio-data 一致）以避開 Windows NTFS 偶發權限警告。
- [ ] api `prod` target 啟用前需先處理 `packages/shared-*` 的 `.ts` main entry — node 不能直接讀 `.ts`，要先各自 build 或讓 api build 內聯。
- [ ] 考慮 Apple Silicon / Linux 開發者：移除 `CHOKIDAR_USEPOLLING=true` 對他們是純粹的 CPU 浪費，可改用 host OS 偵測或 `compose.override.yml`。
- [ ] 加上 `docker compose watch` 設定（compose 2.22+ 的 `develop:` 區塊）取代 bind mount + polling，可以更精準同步檔案變動。
