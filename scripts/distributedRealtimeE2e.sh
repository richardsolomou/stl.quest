#!/bin/sh
set -eu

postgres_name=stlquest-e2e-distributed-postgres
redis_name=stlquest-e2e-distributed-redis
first_name=stlquest-e2e-distributed-a
second_name=stlquest-e2e-distributed-b
network=stlquest-e2e-distributed
s3_port=49000
first_port=4273
second_port=4274

cleanup() {
  kill "${s3_pid:-}" 2>/dev/null || true
  docker rm -f "$first_name" "$second_name" "$postgres_name" "$redis_name" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup
docker network create "$network" >/dev/null

docker run -d --name "$postgres_name" --network "$network" \
  -e POSTGRES_DB=stlquest_realtime_test -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres postgres:16 >/dev/null
docker run -d --name "$redis_name" --network "$network" redis:7.4.2-alpine >/dev/null
FAKE_S3_HOST=0.0.0.0 FAKE_S3_PORT=$s3_port ./node_modules/.bin/tsx e2e/fake-s3.ts &
s3_pid=$!

attempt=0
until docker exec "$postgres_name" pg_isready -U postgres -d stlquest_realtime_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$postgres_name"
    exit 1
  fi
  sleep 1
done

attempt=0
until docker exec "$redis_name" redis-cli ping >/dev/null 2>&1 && curl -s -o /dev/null "http://127.0.0.1:$s3_port"; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$redis_name"
    exit 1
  fi
  sleep 1
done

start_replica() {
  name=$1
  port=$2
  docker run -d --name "$name" --network "$network" --read-only --tmpfs /tmp --add-host host.docker.internal:host-gateway -p "127.0.0.1:$port:3000" \
    -e STLQUEST_DISTRIBUTED=true \
    -e DATABASE_URL=postgres://postgres:postgres@$postgres_name:5432/stlquest_realtime_test \
    -e REDIS_URL=redis://$redis_name:6379 \
    -e INTEGRATIONS_ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE \
    -e STLQUEST_CENTRIFUGO_SECRET=distributed-realtime-secret \
    -e S3_BUCKET=staging \
    -e S3_REGION=us-east-1 \
    -e S3_ENDPOINT=http://host.docker.internal:$s3_port \
    -e S3_ACCESS_KEY_ID=test \
    -e S3_SECRET_ACCESS_KEY=test \
    -e S3_FORCE_PATH_STYLE=true \
    -e STLQUEST_HOSTED=true \
    -e STLQUEST_HOSTED_STORAGE_BUCKET=assets \
    -e STLQUEST_HOSTED_STORAGE_ENDPOINT=http://host.docker.internal:$s3_port \
    -e STLQUEST_HOSTED_STORAGE_REGION=us-east-1 \
    -e STLQUEST_HOSTED_STORAGE_ACCESS_KEY_ID=test \
    -e STLQUEST_HOSTED_STORAGE_SECRET_ACCESS_KEY=test \
    -e STLQUEST_HOSTED_STORAGE_FORCE_PATH_STYLE=true \
    -e STRIPE_SECRET_KEY=sk_test_dummy \
    -e STRIPE_WEBHOOK_SECRET=whsec_dummy \
    -e STRIPE_SUPPORTER_PRICE_ID=price_supporter \
    -e STRIPE_PRO_PRICE_ID=price_pro \
    -e BETTER_AUTH_URL=http://127.0.0.1:$first_port \
    stlquest-e2e >/dev/null
}

wait_for_replica() {
  name=$1
  port=$2
  attempt=0
  until wget -q --spider "http://127.0.0.1:$port/api/health"; do
    if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
      docker logs "$name"
      exit 1
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      docker logs "$name"
      exit 1
    fi
    sleep 1
  done
}

start_replica "$first_name" "$first_port"
wait_for_replica "$first_name" "$first_port"
start_replica "$second_name" "$second_port"
wait_for_replica "$second_name" "$second_port"

docker logs -f "$first_name" &
first_logs=$!
docker logs -f "$second_name" &
second_logs=$!
wait "$first_logs" "$second_logs"
