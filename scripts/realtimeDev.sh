#!/bin/sh
set -eu

secret=stlquest-development-centrifugo-secret
docker run --rm --name stlquest-centrifugo-dev -p 127.0.0.1:8000:8000 \
  -e CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_ENABLED=true \
  -e CENTRIFUGO_CLIENT_SUBSCRIPTION_TOKEN_HMAC_SECRET_KEY="$secret" \
  -e CENTRIFUGO_HTTP_API_KEY="$secret" \
  -e CENTRIFUGO_CLIENT_ALLOWED_ORIGINS='http://localhost:3000' \
  -e CENTRIFUGO_CHANNEL_NAMESPACES='[{"name":"workspace","history_size":1,"history_ttl":"5m","force_recovery":true,"force_recovery_mode":"cache"},{"name":"board","presence":true,"join_leave":true,"allow_presence_for_subscriber":true}]' \
  centrifugo/centrifugo:v6.9.1 centrifugo --health.enabled
