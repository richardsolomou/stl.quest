#!/bin/sh
set -eu

# PLAYWRIGHT_PORT names the run (see e2e/fixtures/environment.ts); the peripheral projects run alongside on port + 200.
port=${PLAYWRIGHT_PORT:-4173}
peripheral_port=$((port + 200))
suffix() { if [ "$1" = 4173 ]; then printf ''; else printf -- '-%s' "$1"; fi; }
STLQUEST_E2E_IMAGE=${STLQUEST_E2E_IMAGE:-$(sh scripts/e2eImage.sh)}
export STLQUEST_E2E_IMAGE

cleanup() {
  for name in main self-hosted hosted https https-proxy preview base-path; do
    docker rm -f "stlquest-e2e-$name$(suffix "$port")" "stlquest-e2e-$name$(suffix "$peripheral_port")" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM
cleanup
if [ "$#" -gt 0 ]; then
  PLAYWRIGHT_PORT=$port ./node_modules/.bin/playwright test "$@"
  exit
fi

status=0
PLAYWRIGHT_PORT=$port ./node_modules/.bin/playwright test --project chromium &
core=$!
PLAYWRIGHT_PORT=$peripheral_port ./node_modules/.bin/playwright test --project hosted-managed --project self-hosted-http --project self-hosted-https --project preview-seed --project base-path &
peripheral=$!
wait "$core" || status=1
wait "$peripheral" || status=1
exit "$status"
