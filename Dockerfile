# One Dockerfile for every container.
#   docker build --build-arg APP=school  --target app    -t triakshi-school .     (APP: marketing | console | school)
#   docker build                          --target worker -t triakshi-worker .    (worker, also runs migrate and tools)
# Node 26 is required: @smw/auth uses crypto.argon2.
ARG NODE_VERSION=26
FROM node:${NODE_VERSION}-alpine AS base
ENV CI=true
# Node 26 no longer ships corepack, so install the pnpm version pinned in package.json (packageManager) directly.
ARG PNPM_VERSION=12.16.1
RUN apk add --no-cache libc6-compat && npm install -g --allow-scripts=pnpm pnpm@${PNPM_VERSION}
WORKDIR /app

# ---- deps: install the whole workspace from the lockfile ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline

# ---- build: one Next.js app ----
FROM deps AS build
ARG APP
# Build-time placeholders so env() validates while Next collects page data. Never reach the runtime image.
# The school app's type check needs more than Node's default heap.
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL_MIGRATE=postgres://build:build@localhost:5432/build \
    DATABASE_URL_SCHOOL=postgres://build:build@localhost:5432/build \
    DATABASE_URL_CONSOLE=postgres://build:build@localhost:5432/build
RUN test -n "$APP" || (echo "pass --build-arg APP=marketing|console|school" && exit 1)
# --env-mode=loose: turbo's strict mode drops the placeholder DATABASE_URL_* above, and env() then fails while Next prerenders.
RUN node scripts/gen-features.mjs && pnpm exec turbo run build --filter="@smw/${APP}" --env-mode=loose && mkdir -p apps/${APP}/public

# ---- app: Next.js standalone server (tracing root is the repo, so server.js sits at apps/<app>/server.js) ----
FROM node:${NODE_VERSION}-alpine AS app
ARG APP
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 APP=${APP}
WORKDIR /app
RUN addgroup -S triakshi && adduser -S triakshi -G triakshi
COPY --from=build --chown=triakshi:triakshi /app/apps/${APP}/.next/standalone ./
COPY --from=build --chown=triakshi:triakshi /app/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=triakshi:triakshi /app/apps/${APP}/public ./apps/${APP}/public
USER triakshi
EXPOSE 3000
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]

# ---- worker: the whole workspace with dependencies (tsx runs TypeScript directly); also used for migrate and ops scripts ----
# shortcut: ships dev dependencies too, upgrade to `pnpm deploy --prod` if the image size starts to matter.
FROM deps AS worker
ENV NODE_ENV=production
RUN node scripts/gen-features.mjs
RUN chown -R node:node /app
USER node
CMD ["pnpm", "--filter", "@smw/worker", "start"]
