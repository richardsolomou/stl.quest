#!/bin/sh
set -eu

# Every checkout on a machine shares the e2e image tag, container names, ports, and data roots, so an e2e build or run
# holds this lock for its whole duration. Nested calls inherit it through STLQUEST_E2E_LOCKED.
if [ "${STLQUEST_E2E_LOCKED:-}" = 1 ]; then
  exec "$@"
fi

lock=${STLQUEST_E2E_LOCK:-/tmp/stlquest-e2e.lock}
waiting=0
until mkdir "$lock" 2>/dev/null; do
  owner=$(cat "$lock/owner" 2>/dev/null || true)
  pid=${owner%% *}
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
    echo "Removing a stale e2e lock left by $owner"
    rm -rf "$lock"
    continue
  fi
  if [ "$waiting" = 0 ]; then
    echo "Waiting for another e2e run to finish: ${owner:-unknown}"
    waiting=1
  fi
  sleep 2
done
echo "$$ $(pwd)" >"$lock/owner"
trap 'rm -rf "$lock"' EXIT
trap 'exit 130' INT TERM

STLQUEST_E2E_LOCKED=1 "$@"
