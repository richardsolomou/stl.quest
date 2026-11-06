import type { Messages } from './i18n'
export function workspaceSlug(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'workspace'
}

/** Bounds every stored workspace name, so the name an owner types to confirm a deletion always fits the same limit. */
export const MAX_WORKSPACE_NAME_LENGTH = 80

/** Shortens a name to `maxLength` UTF-16 units, the unit validation counts, without splitting a surrogate pair. */
export function truncateWorkspaceName(name: string, maxLength = MAX_WORKSPACE_NAME_LENGTH) {
  let truncated = ''
  for (const character of name) {
    if (truncated.length + character.length > maxLength) break
    truncated += character
  }
  return truncated.trimEnd()
}

/** Named once at creation in the creator's language; it is ordinary data afterwards and can be renamed. */
export function personalWorkspaceName(userName: string, t: Messages['common']) {
  const owner = truncateWorkspaceName(userName.trim(), MAX_WORKSPACE_NAME_LENGTH - t.personalWorkspace('').length)
  return owner ? t.personalWorkspace(owner) : t.myWorkspace
}

export const MEMBER_ACTIVITY_INTERVAL_MS = 60 * 60 * 1000

export interface OwnedWorkspace {
  id: string
  name: string
  ownerCount: number
  memberCount: number
}

/**
 * Deleting an account must not leave a workspace without an owner. A workspace the account owns alone is
 * deleted with it when nobody else belongs to it, and blocks the deletion when other members remain.
 */
export function accountDeletionWorkspaces(owned: OwnedWorkspace[]) {
  const soleOwned = owned.filter((workspace) => workspace.ownerCount === 1)
  const blocking = soleOwned.filter((workspace) => workspace.memberCount > 1)
  return {
    blocking: blocking.map(({ name }) => name),
    removed: soleOwned.filter((workspace) => workspace.memberCount === 1),
  }
}
