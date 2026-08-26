# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:70b46548e42db77e0966aaf3619fd068734dc6c77584d526b91126504fd95816 AS centrifugo
ARG TARGETOS
ARG TARGETARCH
ARG CENTRIFUGO_VERSION=6.9.1
ARG CENTRIFUGO_COMMIT=4603be29243501f4ac2787de17c4f0428b27864e
ARG CENTRIFUGO_SOURCE_SHA256=ba8d3d98a9cb14b7f864dc4a72801302f06a9292eb551b00cddf0c80d3188ea0
WORKDIR /src
RUN wget -q "https://github.com/centrifugal/centrifugo/archive/${CENTRIFUGO_COMMIT}.tar.gz" -O source.tar.gz \
    && echo "${CENTRIFUGO_SOURCE_SHA256}  source.tar.gz" | sha256sum -c - \
    && tar -xzf source.tar.gz \
    && cd "centrifugo-${CENTRIFUGO_COMMIT}" \
    && go get google.golang.org/grpc@v1.82.1 \
    && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath -ldflags="-s -w -X github.com/centrifugal/centrifugo/v6/internal/build.Version=${CENTRIFUGO_VERSION}" -o /out/centrifugo .

FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:70b46548e42db77e0966aaf3619fd068734dc6c77584d526b91126504fd95816 AS caddy
ARG TARGETOS
ARG TARGETARCH
ARG CADDY_VERSION=2.11.4
ARG CADDY_SOURCE_SHA256=2c3d02078286a6282cdb4d1d8744077788d556659dac0b64d8ed5886a7e5aeb9
WORKDIR /src
RUN wget -q "https://github.com/caddyserver/caddy/archive/refs/tags/v${CADDY_VERSION}.tar.gz" -O source.tar.gz \
    && echo "${CADDY_SOURCE_SHA256}  source.tar.gz" | sha256sum -c - \
    && tar -xzf source.tar.gz \
    && cd "caddy-${CADDY_VERSION}" \
    && go get google.golang.org/grpc@v1.82.1 golang.org/x/text@v0.39.0 \
    && CGO_ENABLED=0 GOOS="$TARGETOS" GOARCH="$TARGETARCH" go build -trimpath -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v${CADDY_VERSION}" -o /out/caddy ./cmd/caddy

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
COPY printer-catalog/catalog.generated.json ./printer-catalog/catalog.generated.json
COPY drizzle ./drizzle
COPY drizzle-postgres ./drizzle-postgres
COPY scripts/checkBuiltAssets.ts scripts/containerRuntime.ts scripts/containerRuntimeConfig.ts scripts/previewModels.ts scripts/seedPreview.ts ./scripts/
COPY ras-stack.assets.json tsconfig.json vite.config.ts ./
ARG VITE_POSTHOG_HOST
ARG VITE_POSTHOG_PROJECT_TOKEN
RUN pnpm build

FROM node:24-alpine
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
COPY --from=centrifugo /out/centrifugo /usr/local/bin/centrifugo
COPY --from=caddy /out/caddy /usr/local/bin/caddy
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
