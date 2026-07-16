import { AsyncLocalStorage } from 'node:async_hooks'
import type { Invite } from '../core/types'

type InviteContext = { token?: string; claimed?: Invite; provisioning?: boolean }
const storage = new AsyncLocalStorage<InviteContext>()

export function withAuthInvite<T>(token: string | undefined, work: () => T): T {
  return storage.run({ token }, work)
}

export function withAuthProvisioning<T>(work: () => T): T {
  return storage.run({ provisioning: true }, work)
}

export function authProvisioningAllowed() {
  return storage.getStore()?.provisioning === true
}

export function claimAuthInvite(claim: (token: string, email: string) => Invite | undefined, email: string) {
  const context = storage.getStore()
  if (!context?.token) return undefined
  context.claimed ??= claim(context.token, email)
  return context.claimed
}

export function claimedAuthInvite() {
  return storage.getStore()?.claimed
}
