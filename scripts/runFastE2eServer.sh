#!/bin/sh
set -eu

port=${PLAYWRIGHT_PORT:-4173}
app_port=$((port + 1000))
realtime_port=$((port + 4000))
root=${PLAYWRIGHT_DATA_ROOT:-/tmp/stlquest-playwright-$port}
suffix="-$port"
realtime_name="stlquest-e2e-fast-realtime$suffix"
proxy_name="stlquest-e2e-fast-proxy$suffix"
secret=stlquest-e2e-realtime-secret

cleanup() {
  kill "${app_pid:-}" 2>/dev/null || true
  docker rm -f "$proxy_name" "$realtime_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup
rm -rf "$root"
mkdir -p "$root/data" "$root/prints"

docker run -d --rm --name "$realtime_name" -p "$realtime_port:8000" \
  -e CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED=true \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_HTTP_API_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_ALLOWED_ORIGINS="http://127.0.0.1:$port" \
  -v "$PWD/realtime.json:/centrifugo/realtime.json:ro" \
  centrifugo/centrifugo:v6.9.1 centrifugo --config=/centrifugo/realtime.json --health.enabled >/dev/null

docker run -d --rm --name "$proxy_name" -p "127.0.0.1:$port:3000" \
  --add-host host.docker.internal:host-gateway \
  -e APP_UPSTREAM="host.docker.internal:$app_port" \
  -e REALTIME_UPSTREAM="host.docker.internal:$realtime_port" \
  -v "$PWD/e2e/core.Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.4-alpine >/dev/null

DATA_DIR="$root/data" \
PRINTS_DIR="$root/prints" \
BETTER_AUTH_URL="http://127.0.0.1:$port" \
PORT="$app_port" \
STLQUEST_REALTIME_SECRET="$secret" \
STLQUEST_REALTIME_API_URL="http://127.0.0.1:$realtime_port/api" \
node .output/server/index.mjs &
app_pid=$!
wait "$app_pid"
