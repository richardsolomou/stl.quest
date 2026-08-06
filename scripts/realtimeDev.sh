#!/bin/sh
set -eu

secret=stlquest-development-realtime-secret
detach=
if [ "${1:-}" = "--detach" ]; then
  detach=-d
fi

docker run --rm $detach --name stlquest-realtime-dev -p 127.0.0.1:8000:8000 \
  -e CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED=true \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_HTTP_API_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_ALLOWED_ORIGINS='http://localhost:3000' \
  -v "$PWD/realtime.json:/centrifugo/realtime.json:ro" \
  centrifugo/centrifugo:v6.9.1 centrifugo --config=/centrifugo/realtime.json --health.enabled
