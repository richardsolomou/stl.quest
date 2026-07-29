import type { Invite } from './types'

export function inviteIsActive(invite: Pick<Invite, 'usedAt' | 'expiresAt'>, now: number) {
  return invite.usedAt === undefined && invite.expiresAt > now
}
