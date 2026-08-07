import crypto from 'node:crypto'
import fs from 'node:fs'
import type { Identity } from '../core/types'

const TOKEN_TTL_SECONDS = 5 * 60

export function realtimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const secret = environment.STLQUEST_REALTIME_SECRET?.trim() || readSecret(environment.STLQUEST_REALTIME_SECRET_FILE)
  const apiKey = environment.STLQUEST_REALTIME_API_KEY?.trim() || secret
  if (!secret || !apiKey) throw new Error('Realtime secret is not configured')
  return {
    apiUrl: (environment.STLQUEST_REALTIME_API_URL?.trim() || (process.env.NODE_ENV === 'test' ? '' : 'http://127.0.0.1:8000/api')).replace(
      /\/$/,
      '',
    ),
    apiKey,
    secret,
  }
}

export function connectionToken(identity: Identity, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!identity.workspaceId) throw new Error('Realtime identity has no workspace')
  return sign({ sub: identity.id, exp: now + TOKEN_TTL_SECONDS, channels: [`workspace:${identity.workspaceId}`] }, secret)
}

export function subscriptionToken(identity: Identity, channel: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  return sign(
    {
      sub: identity.id,
      channel,
      exp: now + TOKEN_TTL_SECONDS,
      expire_at: 0,
      info: { id: identity.id, name: identity.name, image: identity.image },
    },
    secret,
  )
}

export function canSubscribeToBoard(
  identity: Pick<Identity, 'role'>,
  channel: unknown,
  workspaceSlug: string,
  privateRequests: boolean,
): channel is string {
  return channel === `board:${workspaceSlug}` && (identity.role === 'admin' || !privateRequests)
}

function sign(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const unsigned = `${header}.${claims}`
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

function readSecret(configuredPath: string | undefined) {
  const secretPath = configuredPath?.trim() || (process.env.NODE_ENV === 'production' ? '/data/realtime-secret' : undefined)
  if (!secretPath) return 'stlquest-development-realtime-secret'
  try {
    return fs.readFileSync(secretPath, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
