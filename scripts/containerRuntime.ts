import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { persistedSecret } from 'ras-stack/auth'
import { runRealtimeStack } from 'ras-stack/runtime'

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
const runtimeDirectory = '/tmp/stlquest-runtime'
process.exitCode = await runRealtimeStack({
  app: { command: process.execPath, args: ['.output/server/index.mjs'], env: { ...process.env, PORT: '3001' } },
  centrifugo: {
    configPath: '/app/realtime.json',
    env: process.env,
    environment: {
      apiKey: process.env.STLQUEST_REALTIME_API_KEY?.trim() || secret,
      clientTokenSecret: secret,
      subscriptionTokenSecret: secret,
      ...(redisUrl ? { redisUrl } : {}),
    },
  },
  caddy: {
    configPath: path.join(runtimeDirectory, 'Caddyfile'),
    env: process.env,
    runtime: {
      configHome: path.join(runtimeDirectory, 'caddy-config'),
      dataHome: path.join(runtimeDirectory, 'caddy-data'),
    },
  },
})

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required in distributed mode`)
  return value
}
