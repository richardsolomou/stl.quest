import crypto from 'node:crypto'
import Redis from 'ioredis'
import type { Identity } from '../core/types'

export type BoardViewer = Pick<Identity, 'id' | 'name' | 'image'>

const LEASE_MS = 45_000
const REFRESH_MS = 15_000
const REFRESH_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1])
if #expired > 0 then
  redis.call('ZREM', KEYS[1], unpack(expired))
  redis.call('HDEL', KEYS[2], unpack(expired))
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
return expired
`

export class DistributedBoardPresence {
  private subscriber: Redis
  private listeners = new Map<string, Set<(viewers: BoardViewer[]) => void>>()
  private refreshes = new Set<ReturnType<typeof setInterval>>()

  constructor(
    private redis: Redis,
    private onError: (error: unknown) => void = () => undefined,
  ) {
    this.subscriber = redis.duplicate()
    this.subscriber.on('message', (channel) => void this.broadcast(channel.slice('stlquest:presence:events:'.length)))
    this.subscriber.on('error', onError)
  }

  async join(workspaceId: string, identity: Identity, listener?: (viewers: BoardViewer[]) => void) {
    const connectionId = crypto.randomUUID()
    const viewer: BoardViewer = { id: identity.id, name: identity.name, image: identity.image }
    const channel = this.channel(workspaceId)
    if (listener) {
      const listeners = this.listeners.get(workspaceId) ?? new Set()
      listeners.add(listener)
      this.listeners.set(workspaceId, listeners)
      if (listeners.size === 1) await this.subscriber.subscribe(channel)
    }
    await this.refresh(workspaceId, connectionId, viewer, true)
    const timer = setInterval(() => void this.refresh(workspaceId, connectionId, viewer, false).catch(this.onError), REFRESH_MS)
    timer.unref()
    this.refreshes.add(timer)

    let left = false
    return () => {
      if (left) return
      left = true
      clearInterval(timer)
      this.refreshes.delete(timer)
      if (listener) {
        const listeners = this.listeners.get(workspaceId)
        listeners?.delete(listener)
        if (!listeners?.size) {
          this.listeners.delete(workspaceId)
          void this.subscriber.unsubscribe(channel).catch(this.onError)
        }
      }
      void this.remove(workspaceId, connectionId).catch(this.onError)
    }
  }

  async close() {
    for (const timer of this.refreshes) clearInterval(timer)
    this.refreshes.clear()
    await this.subscriber.quit()
  }

  private async refresh(workspaceId: string, connectionId: string, viewer: BoardViewer, joined: boolean) {
    const now = Date.now()
    const expiredIds = (await this.redis.eval(
      REFRESH_SCRIPT,
      2,
      this.connectionsKey(workspaceId),
      this.viewersKey(workspaceId),
      now,
      now + LEASE_MS,
      connectionId,
      JSON.stringify(viewer),
    )) as string[]
    if (joined || expiredIds.length) await this.redis.publish(this.channel(workspaceId), 'changed')
  }

  private async remove(workspaceId: string, connectionId: string) {
    await this.redis.multi().zrem(this.connectionsKey(workspaceId), connectionId).hdel(this.viewersKey(workspaceId), connectionId).exec()
    await this.redis.publish(this.channel(workspaceId), 'changed')
  }

  private async broadcast(workspaceId: string) {
    try {
      const connectionIds = await this.redis.zrangebyscore(this.connectionsKey(workspaceId), Date.now(), '+inf')
      const encoded = connectionIds.length ? await this.redis.hmget(this.viewersKey(workspaceId), ...connectionIds) : []
      const unique = new Map<string, BoardViewer>()
      for (const value of encoded) {
        if (!value) continue
        const viewer = JSON.parse(value) as BoardViewer
        unique.set(viewer.id, viewer)
      }
      const viewers = [...unique.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      for (const listener of this.listeners.get(workspaceId) ?? []) listener(viewers)
    } catch (error) {
      this.onError(error)
    }
  }

  private channel(workspaceId: string) {
    return `stlquest:presence:events:${workspaceId}`
  }

  private connectionsKey(workspaceId: string) {
    return `stlquest:presence:connections:${workspaceId}`
  }

  private viewersKey(workspaceId: string) {
    return `stlquest:presence:viewers:${workspaceId}`
  }
}
