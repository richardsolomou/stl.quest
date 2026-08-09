#!/bin/sh
set -eu

cleanup() {
  docker rm -f stlquest-e2e-main stlquest-e2e-self-hosted stlquest-e2e-hosted stlquest-e2e-https stlquest-e2e-https-proxy stlquest-e2e-preview stlquest-e2e-main-4373 stlquest-e2e-self-hosted-4373 stlquest-e2e-hosted-4373 stlquest-e2e-https-4373 stlquest-e2e-https-proxy-4373 stlquest-e2e-preview-4373 >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup
if [ "$#" -gt 0 ]; then
  ./node_modules/.bin/playwright test "$@"
  exit
fi

status=0
./node_modules/.bin/playwright test e2e/00-stlquest.spec.ts e2e/account-settings.spec.ts e2e/request-ordering.spec.ts &
core=$!
PLAYWRIGHT_PORT=4373 ./node_modules/.bin/playwright test --project hosted-managed --project self-hosted-http --project self-hosted-https --project preview-seed &
peripheral=$!
wait "$core" || status=1
wait "$peripheral" || status=1
exit "$status"
