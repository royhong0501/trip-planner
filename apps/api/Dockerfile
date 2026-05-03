# Multi-stage build for @trip-planner/api (Nest.js 10 + Prisma 5).
# Built from the monorepo root (context: ../../) so workspace resolution works.
#
# Stages:
#   base     - shared OS layer with openssl/curl needed by Prisma engines
#   deps     - install all workspaces using root package-lock.json
#   dev      - runs `tsx watch` against bind-mounted source (used by docker-compose)
#   build    - compiles api to dist/
#   prod     - minimal runtime that runs `node dist/main.js`

FROM node:20-bookworm-slim AS base
WORKDIR /workspace
ENV CI=true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# ---------- deps ----------
FROM base AS deps
# Copy only manifests first so the install layer can cache.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-schema/package.json ./packages/shared-schema/
COPY packages/api-client/package.json ./packages/api-client/
# api postinstall runs `prisma generate`, which needs the schema.
COPY apps/api/prisma ./apps/api/prisma
RUN npm ci

# ---------- dev (used by docker-compose) ----------
FROM deps AS dev
ENV NODE_ENV=development
# node --watch + chokidar can't see bind-mount events on Windows/macOS hosts
# without polling. CHOKIDAR_USEPOLLING covers chokidar consumers; for node's
# native --watch the experimental flag is enough — it falls back to polling
# when inotify events don't fire.
ENV CHOKIDAR_USEPOLLING=true
EXPOSE 3000
WORKDIR /workspace/apps/api
# Use SWC for runtime: tsc/tsx (esbuild) don't reliably emit
# `design:paramtypes` metadata, which NestJS needs for type-based DI. SWC does.
CMD ["npm", "run", "dev"]

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npm run build -w @trip-planner/api

# ---------- prod ----------
FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /workspace/package.json /workspace/package-lock.json ./
COPY --from=build /workspace/apps/api/package.json ./apps/api/
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/node_modules ./node_modules
EXPOSE 3000
WORKDIR /workspace/apps/api
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -fsS http://localhost:3000/health || exit 1
CMD ["node", "dist/main.js"]
