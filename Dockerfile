# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
RUN npm i -g pnpm@11.12.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile
COPY src ./src
COPY public ./public
COPY printer-catalog/catalog.generated.json ./printer-catalog/catalog.generated.json
COPY drizzle ./drizzle
COPY scripts/checkBuiltAssets.ts ./scripts/checkBuiltAssets.ts
COPY tsconfig.json vite.config.ts ./
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_PROJECT_TOKEN
RUN pnpm build

FROM node:24-alpine
LABEL org.opencontainers.image.title="STL Quest" \
      org.opencontainers.image.description="Self-hosted 3D print request queue" \
      org.opencontainers.image.source="https://github.com/richardsolomou/stl.quest" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /data /prints \
    && chown -R node:node /app /data /prints
COPY --from=build --chown=node:node /app/.output ./.output
COPY --chown=node:node LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node LICENSES ./LICENSES
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_PROJECT_TOKEN
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data PRINTS_DIR=/prints \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST VITE_POSTHOG_PROJECT_TOKEN=$VITE_POSTHOG_PROJECT_TOKEN
VOLUME ["/data", "/prints"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1
USER node
CMD ["node", ".output/server/index.mjs"]
