# Multi-stage build for @trip-planner/web (Vite + React 18).
# Built from the monorepo root (context: ../../).
#
# Stages:
#   base   - common workspace layer
#   deps   - install all workspaces from root package-lock.json
#   dev    - vite dev server (used by docker-compose)
#   build  - vite build → dist/
#   prod   - nginx serving the built static assets

FROM node:20-bookworm-slim AS base
WORKDIR /workspace
ENV CI=true

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-schema/package.json ./packages/shared-schema/
COPY packages/api-client/package.json ./packages/api-client/
# api postinstall runs `prisma generate`, which needs schema even when we only build web.
COPY apps/api/prisma ./apps/api/prisma
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm ci

# ---------- dev (used by docker-compose) ----------
FROM deps AS dev
ENV NODE_ENV=development
# Vite/chokidar needs polling under Windows/macOS bind-mounts.
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 5173
WORKDIR /workspace/apps/web
# vite.config.ts already binds host '::' so 0.0.0.0 is reachable from the host.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build -w @trip-planner/web

# ---------- prod (static via nginx) ----------
FROM nginx:1.27-alpine AS prod
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
# SPA fallback: route everything that's not a file to index.html.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri /index.html; }\n}\n' \
  > /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
