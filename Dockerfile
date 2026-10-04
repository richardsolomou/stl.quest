# syntax=docker/dockerfile:1
FROM ghcr.io/richardsolomou/ras-stack-runtime-binaries:runtime-v1.0.4@sha256:183261400ef822d3dfb7ae9391dc3836d343e01de41ab131df6a42751f87288e AS runtime-binaries

FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack install --global pnpm@11.15.0
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --frozen-lockfile
COPY package.json ./package.json
RUN pnpm install --offline --frozen-lockfile
COPY src ./src
COPY public ./public
COPY catalogs/printers/catalog.generated.json ./catalogs/printers/catalog.generated.json
COPY catalogs/resins/catalog.generated.json ./catalogs/resins/catalog.generated.json
COPY catalogs/electricity/catalog.generated.json ./catalogs/electricity/catalog.generated.json
COPY catalogs/equipment/catalog.json ./catalogs/equipment/catalog.json
COPY drizzle ./drizzle
COPY drizzle-postgres ./drizzle-postgres
COPY scripts/checkBuiltAssets.ts scripts/containerRuntime.ts scripts/containerRuntimeConfig.ts scripts/previewModels.ts scripts/seedPreview.ts ./scripts/
COPY ras-stack.assets.json tsconfig.json vite.config.ts ./
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_PROJECT_TOKEN
ARG POSTHOG_PROJECT_ID
ARG POSTHOG_HOST
ARG GITHUB_ACTIONS
ARG GITHUB_SHA
ARG GITHUB_REF_NAME
ARG GITHUB_REPOSITORY
ARG GITHUB_SERVER_URL
ENV POSTHOG_PROJECT_ID=$POSTHOG_PROJECT_ID \
    POSTHOG_HOST=$POSTHOG_HOST \
    GITHUB_ACTIONS=$GITHUB_ACTIONS \
    GITHUB_SHA=$GITHUB_SHA \
    GITHUB_REF_NAME=$GITHUB_REF_NAME \
    GITHUB_REPOSITORY=$GITHUB_REPOSITORY \
    GITHUB_SERVER_URL=$GITHUB_SERVER_URL
RUN --mount=type=secret,id=POSTHOG_API_KEY,env=POSTHOG_API_KEY pnpm build

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="STL Quest" \
      org.opencontainers.image.description="A private 3D-print request and production queue for resin and filament printers." \
      org.opencontainers.image.source="https://github.com/richardsolomou/stl.quest" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /data /prints \
    && chown -R node:node /app /data /prints
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=runtime-binaries /usr/local/bin/centrifugo /usr/local/bin/centrifugo
COPY --from=runtime-binaries /usr/local/bin/caddy /usr/local/bin/caddy
COPY --chown=node:node realtime.json ./realtime.json
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node LICENSES ./LICENSES
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_PROJECT_TOKEN
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PRINTS_DIR=/prints \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST VITE_POSTHOG_PROJECT_TOKEN=$VITE_POSTHOG_PROJECT_TOKEN
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1
USER node
CMD ["node", ".output/server/container-runtime.mjs"]
