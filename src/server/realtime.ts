import { realtimeEnvironment, signRealtimeToken } from 'ras-stack/realtime'
import type { Identity } from '../core/types'

export function realtimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const realtime = realtimeEnvironment(environment, { prefix: 'STLQUEST_', developmentSecret: 'stlquest-development-realtime-secret' })
  if (!realtime) throw new Error('Realtime secret is not configured')
  // Tests publish to nothing rather than to a Centrifugo that is not running.
  return process.env.NODE_ENV === 'test' ? { ...realtime, apiUrl: '' } : realtime
}

export function connectionToken(identity: Identity, secret: string, now = Math.floor(Date.now() / 1000)) {
  if (!identity.workspaceId) throw new Error('Realtime identity has no workspace')
  return signRealtimeToken(identity.id, { channels: [`workspace:${identity.workspaceId}`] }, { secret, now })
}

export function subscriptionToken(identity: Identity, channel: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  return signRealtimeToken(
    identity.id,
    {
      channel,
      expire_at: 0,
      info: { id: identity.id, name: identity.name, image: identity.image },
    },
    { secret, now },
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
