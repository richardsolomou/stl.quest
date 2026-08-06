#!/bin/sh
set -eu

secret_file=${STLQUEST_CENTRIFUGO_SECRET_FILE:-/data/centrifugo-secret}
if [ -z "${STLQUEST_CENTRIFUGO_SECRET:-}" ]; then
  if [ ! -s "$secret_file" ]; then
    umask 077
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$secret_file"
  fi
  STLQUEST_CENTRIFUGO_SECRET=$(cat "$secret_file")
  export STLQUEST_CENTRIFUGO_SECRET
fi

export CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=$STLQUEST_CENTRIFUGO_SECRET
export CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED=true
export CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY=$STLQUEST_CENTRIFUGO_SECRET
export CENTRIFUGO_HTTP_API_KEY=${STLQUEST_CENTRIFUGO_API_KEY:-$STLQUEST_CENTRIFUGO_SECRET}
export CENTRIFUGO_CLIENT_ALLOWED_ORIGINS='*'
export CENTRIFUGO_HTTP_SERVER_ADDRESS=127.0.0.1
export CENTRIFUGO_HEALTH_ENABLED=true
export XDG_CONFIG_HOME=/tmp/caddy-config
export XDG_DATA_HOME=/tmp/caddy-data

if [ "${STLQUEST_SEED_PREVIEW:-}" = true ]; then
  node .output/server/seed-preview.mjs
fi

if [ "${STLQUEST_DISTRIBUTED:-}" = true ]; then
  export CENTRIFUGO_ENGINE_TYPE=redis
  export CENTRIFUGO_ENGINE_REDIS_ADDRESS=${REDIS_URL:?REDIS_URL is required in distributed mode}
fi

centrifugo --config=/app/centrifugo.json &
centrifugo_pid=$!
PORT=3001 node .output/server/index.mjs &
app_pid=$!
caddy run --config /app/Caddyfile --adapter caddyfile &
caddy_pid=$!

cleanup() {
  kill "$caddy_pid" "$app_pid" "$centrifugo_pid" 2>/dev/null || true
  wait "$caddy_pid" "$app_pid" "$centrifugo_pid" 2>/dev/null || true
}
shutdown() {
  trap - EXIT INT TERM
  cleanup
  exit 0
}
trap cleanup EXIT
trap shutdown INT TERM

while kill -0 "$caddy_pid" 2>/dev/null && kill -0 "$app_pid" 2>/dev/null && kill -0 "$centrifugo_pid" 2>/dev/null; do
  sleep 1
done
exit 1
