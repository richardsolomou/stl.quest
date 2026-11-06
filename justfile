set dotenv-load

default:
    @just --list

install:
    corepack enable
    pnpm install
    git config core.hooksPath .githooks

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
    sh scripts/e2eLock.sh docker build -t stlquest-e2e .

e2e *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && just e2e-run "$@"' e2e {{ args }}

e2e-run *args:
    sh scripts/e2eLock.sh sh scripts/runE2e.sh {{ args }}

e2e-distributed:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && just e2e-distributed-run'

e2e-distributed-run:
    sh scripts/e2eLock.sh pnpm exec playwright test --config playwright.distributed.config.ts

e2e-ci:
    sh scripts/e2eLock.sh sh -c 'just e2e-run e2e/00-stlquest.spec.ts e2e/account-settings.spec.ts e2e/chunk-recovery.spec.ts e2e/request-ordering.spec.ts && just e2e-run --project hosted-managed --project self-hosted-http --project self-hosted-https --project preview-seed && just e2e-distributed-run'

e2e-screenshots *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && CAPTURE_E2E_SCREENSHOTS=1 just e2e-run "$@"' e2e {{ args }}

e2e-trace *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && PLAYWRIGHT_TRACE=1 just e2e-run "$@"' e2e {{ args }}
