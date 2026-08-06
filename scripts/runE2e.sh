#!/bin/sh
set -eu

cleanup() {
  docker rm -f stlquest-e2e-main stlquest-e2e-self-hosted stlquest-e2e-hosted stlquest-e2e-https stlquest-e2e-https-proxy stlquest-e2e-preview >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup
./node_modules/.bin/playwright test "$@"
