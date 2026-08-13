set dotenv-load

default:
    @just --list

install:
    corepack enable
    pnpm install

dev:
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p data-dev prints-dev
    just realtime --detach
    cleanup() {
        docker rm --force stlquest-realtime-dev >/dev/null 2>&1 || true
    }
    trap cleanup EXIT INT TERM
    DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev

realtime *args:
    pnpm realtime {{ args }}

format:
    pnpm format

lint:
    pnpm lint

build:
    pnpm build

typecheck:
    pnpm typecheck

test *args:
    pnpm exec vitest run {{ args }}

check:
    pnpm check

# CI runs the stateful test suite in isolated shards after these checks.
check-ci:
    pnpm check:ci

catalog-check:
    pnpm catalog:check

backup *args:
    pnpm backup {{ args }}

e2e-install:
    pnpm exec playwright install chromium

e2e-build:
    docker build -t stlquest-e2e .

e2e *args: e2e-build
    sh scripts/runE2e.sh {{ args }}

e2e-run *args:
    sh scripts/runE2e.sh {{ args }}

e2e-distributed: e2e-build
    pnpm exec playwright test --config playwright.distributed.config.ts

e2e-distributed-run:
    pnpm exec playwright test --config playwright.distributed.config.ts

e2e-ci:
    sh scripts/runE2e.sh e2e/00-stlquest.spec.ts e2e/request-ordering.spec.ts
    pnpm exec playwright test --config playwright.distributed.config.ts

e2e-screenshots *args: e2e-build
    CAPTURE_E2E_SCREENSHOTS=1 sh scripts/runE2e.sh {{ args }}

e2e-trace *args: e2e-build
    PLAYWRIGHT_TRACE=1 sh scripts/runE2e.sh {{ args }}
