#!/bin/sh
set -eu

status=0
sh scripts/runE2e.sh e2e/00-stlquest.spec.ts e2e/request-ordering.spec.ts &
core=$!
pnpm exec playwright test --config playwright.distributed.config.ts &
distributed=$!
wait "$core" || status=1
wait "$distributed" || status=1
exit "$status"
