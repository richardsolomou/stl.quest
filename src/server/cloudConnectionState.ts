import crypto from 'node:crypto'
import type { IntegrationConfig } from '../core/auth'
import { getStoredIntegrationConfig, type SettingStore } from './integrations'

const STATE_TTL = 10 * 60 * 1_000

type PendingConnection = {
  adminId: string
  expiresAt: number
  stateHash: string
}

export function connectionIntegrationConfig(repository: SettingStore): IntegrationConfig {
  return getStoredIntegrationConfig(repository) ?? { passwordEnabled: true }
}

export function createConnectionState() {
  const state = crypto.randomBytes(32).toString('base64url')
  return { state, stateHash: hash(state), expiresAt: Date.now() + STATE_TTL }
}

export function connectionStateMatches(pending: PendingConnection, state: string, adminId: string) {
  return pending.expiresAt >= Date.now() && pending.adminId === adminId && hashesMatch(pending.stateHash, hash(state))
}

export function hashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes)
}

function hash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
