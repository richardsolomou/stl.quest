#!/bin/sh
set -eu

# Boots the image with an empty data directory, waits for /api/health, then exercises the native SQLite
# backup path and argon2 inside the container: the parts most likely to break on a single architecture.
image=${1:-stlquest-e2e}
name=stlquest-e2e-smoke
port=${SMOKE_PORT:-4380}

docker rm -f "$name" >/dev/null 2>&1 || true
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT INT TERM
# shellcheck disable=SC2046
docker run -d --name "$name" --read-only --tmpfs /tmp \
  --tmpfs /data:uid=1000,gid=1000 --tmpfs /prints:uid=1000,gid=1000 \
  -p "127.0.0.1:$port:3000" $(sh scripts/e2eContainerArgs.sh "$image") "$image" >/dev/null

healthy=
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health")" = 200 ]; then
    healthy=1
    break
  fi
  sleep 1
done
if [ -z "$healthy" ]; then
  docker logs "$name"
  echo "health check did not return 200" >&2
  exit 1
fi

docker exec -w /app/.output/server "$name" node --input-type=module -e "
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/')
const Database = require('better-sqlite3')
const argon2 = require('argon2')
const live = new Database('/data/stlquest.sqlite', { fileMustExist: true })
live.exec(\"VACUUM INTO '/tmp/smoke-backup.sqlite'\")
live.close()
const copy = new Database('/tmp/smoke-backup.sqlite', { readonly: true, fileMustExist: true })
const integrity = copy.pragma('quick_check', { simple: true })
copy.close()
if (integrity !== 'ok') throw new Error('backup integrity check failed: ' + integrity)
const hash = await argon2.hash('smoke')
if (!(await argon2.verify(hash, 'smoke'))) throw new Error('argon2 verification failed')
console.log(process.arch + ': health, SQLite backup and argon2 passed')
"
test "$(docker inspect --format '{{.State.Running}}' "$name")" = true
