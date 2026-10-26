# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f website/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack install --global pnpm@12.13.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ras.config.ts ./
RUN pnpm fetch
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY public/favicon.svg ./public/favicon.svg
COPY website ./website
RUN pnpm website:build

FROM caddy:2.11.4-alpine
COPY website/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/website/dist /srv
