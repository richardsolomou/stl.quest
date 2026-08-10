import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { persistedSecret } from 'ras-stack/auth'
import { caddyRealtimeProxy, caddyRuntimeEnvironment, centrifugoEnvironment, superviseProcesses } from 'ras-stack/runtime'

const secretFile = process.env.STLQUEST_REALTIME_SECRET_FILE?.trim() || '/data/realtime-secret'
const secret = persistedSecret({
  directory: path.dirname(secretFile),
  filename: path.basename(secretFile),
  environmentKey: 'STLQUEST_REALTIME_SECRET',
  bytes: 48,
})
process.env.STLQUEST_REALTIME_SECRET = secret

if (process.env.STLQUEST_SEED_PREVIEW === 'true') {
  execFileSync(process.execPath, ['.output/server/seed-preview.mjs'], { stdio: 'inherit' })
}

const redisUrl = process.env.STLQUEST_DISTRIBUTED === 'true' ? requiredEnvironment('REDIS_URL') : undefined
const dataDirectory = process.env.DATA_DIR?.trim() || '/data'
const caddyfile = path.join(dataDirectory, 'runtime.Caddyfile')
fs.writeFileSync(caddyfile, caddyRealtimeProxy())

const status = await superviseProcesses([
  {
    name: 'realtime',
    command: 'centrifugo',
    args: ['--config=/app/realtime.json'],
    env: {
      ...process.env,
      ...centrifugoEnvironment({
        apiKey: process.env.STLQUEST_REALTIME_API_KEY?.trim() || secret,
        clientTokenSecret: secret,
        subscriptionTokenSecret: secret,
        ...(redisUrl ? { redisUrl } : {}),
      }),
    },
  },
  { name: 'app', command: process.execPath, args: ['.output/server/index.mjs'], env: { ...process.env, PORT: '3001' } },
  {
    name: 'proxy',
    command: 'caddy',
    args: ['run', '--config', caddyfile, '--adapter', 'caddyfile'],
    env: {
      ...process.env,
      ...caddyRuntimeEnvironment({
        configHome: path.join(dataDirectory, 'caddy-config'),
        dataHome: path.join(dataDirectory, 'caddy-data'),
      }),
    },
  },
])
process.exitCode = status

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required in distributed mode`)
  return value
}
