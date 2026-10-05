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
  return {
    blocking: soleOwned.filter((workspace) => workspace.memberCount > 1),
    removed: soleOwned.filter((workspace) => workspace.memberCount === 1),
  }
}
