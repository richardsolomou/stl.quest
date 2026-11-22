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
    pnpm realtime &
    realtime=$!
    cleanup() {
        kill "$realtime" 2>/dev/null || true
        docker rm --force "$(basename "$PWD")-realtime" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT INT TERM
    DATA_DIR=./data-dev PRINTS_DIR=./prints-dev BETTER_AUTH_URL=http://localhost:3000 pnpm dev

# A print farm's printers, equipment, priced consumables, requesters, prints, and usage in the dev database; sign in as power@stl.quest.
seed-power *args:
    DATA_DIR=./data-dev PRINTS_DIR=./prints-dev pnpm exec tsx scripts/seedPowerUser.ts {{ args }}

# Deletes the seeded print farm workspace and seeds it again from scratch.
seed-power-reset:
    just seed-power --reset

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
    sh scripts/e2eLock.sh sh -c 'docker build -t "$(sh scripts/e2eImage.sh)" .'

e2e *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && just e2e-run "$@"' e2e {{ args }}

e2e-run *args:
    sh scripts/e2eLock.sh sh scripts/runE2e.sh {{ args }}

e2e-distributed:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && just e2e-distributed-run'

# The distributed stack uses fixed ports and names, so it also holds one machine-wide lock.
e2e-distributed-run:
    sh scripts/e2eLock.sh env STLQUEST_E2E_LOCKED= STLQUEST_E2E_LOCK=/tmp/stlquest-e2e-distributed.lock sh scripts/e2eLock.sh pnpm exec playwright test --config playwright.distributed.config.ts

e2e-ci:
    sh scripts/e2eLock.sh sh -c 'just e2e-run && just e2e-distributed-run'

e2e-screenshots *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && CAPTURE_E2E_SCREENSHOTS=1 just e2e-run "$@"' e2e {{ args }}

e2e-trace *args:
    sh scripts/e2eLock.sh sh -c 'just e2e-build && PLAYWRIGHT_TRACE=1 just e2e-run "$@"' e2e {{ args }}
