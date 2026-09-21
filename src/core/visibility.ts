import type { BoardConfig, Identity, MemberRequestVisibility } from './types'

export type MemberRequestVisibilityChoice = MemberRequestVisibility | 'default'

/** Stored board settings are plain JSON, so unknown shapes fall back to the shared default. */
export function normalizeBoardConfig(stored?: Partial<BoardConfig> | null): BoardConfig {
  return { privateRequests: stored?.privateRequests === true, memberVisibility: normalizeMemberVisibility(stored?.memberVisibility) }
}

function normalizeMemberVisibility(stored: unknown): Record<string, MemberRequestVisibility> {
  if (!stored || typeof stored !== 'object') return {}
  const entries = Object.entries(stored as Record<string, unknown>).filter(
    (entry): entry is [string, MemberRequestVisibility] => entry[1] === 'own' || entry[1] === 'all',
  )
  return Object.fromEntries(entries)
}

/** Admins always see the whole board; everyone else follows their override, then the workspace default. */
export function memberRequestVisibility(config: BoardConfig, identity: Pick<Identity, 'id' | 'role'>): MemberRequestVisibility {
  if (identity.role === 'admin') return 'all'
  return config.memberVisibility[identity.id] ?? (config.privateRequests ? 'own' : 'all')
}

export function seesOnlyOwnRequests(config: BoardConfig, identity: Pick<Identity, 'id' | 'role'>): boolean {
  return memberRequestVisibility(config, identity) === 'own'
}

/** People are hidden alongside their requests, so a scoped member never learns who else is in the workspace. */
export function visiblePeople<T extends { id: string }>(people: T[], config: BoardConfig, identity: Pick<Identity, 'id' | 'role'>): T[] {
  return seesOnlyOwnRequests(config, identity) ? people.filter((person) => person.id === identity.id) : people
}

export function withMemberRequestVisibility(config: BoardConfig, userId: string, choice: MemberRequestVisibilityChoice): BoardConfig {
  const memberVisibility = { ...config.memberVisibility }
  delete memberVisibility[userId]
  if (choice !== 'default') memberVisibility[userId] = choice
  return { ...config, memberVisibility }
}
