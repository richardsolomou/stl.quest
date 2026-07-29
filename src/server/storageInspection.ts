import { S3AssetStore } from '../adapters/s3'
import { errorMessage } from '../core/error'
import type { AssetStore, Repository, StorageConfig, StorageMigration } from '../core/types'
import { buildAssetStore } from './app'
import { resolveManagedStorageConfig } from './managedStorage'
import { hostedStorageRequiresRemote, type DeploymentSettingsReader } from './storagePolicy'

export async function maskStorage(config: StorageConfig, repository?: DeploymentSettingsReader) {
  if (repository && (await hostedStorageRequiresRemote(config, repository))) return { ...config, root: '' }
  if (config.adapter === 'webdav') return { ...config, password: '' }
  return config.adapter === 's3' ? { ...config, secretAccessKey: '' } : config
}

export async function maskStorageMigration(migration: StorageMigration | undefined, repository?: DeploymentSettingsReader) {
  if (!migration) return undefined
  const [source, destination] = await Promise.all([
    maskStorage(migration.source, repository),
    maskStorage(migration.destination, repository),
  ])
  return { ...migration, source, destination }
}

export async function validateStorageCandidate(config: StorageConfig, repository: Repository, workspaceId: string) {
  // Probe the workspace namespace; a writable parent says nothing about an existing child directory.
  const candidate =
    config.adapter === 'managed' ? managedStorageCandidate(workspaceId) : await buildAssetStore(config, repository, workspaceId)
  try {
    await candidate.initialize()
    await candidate.writable()
    return candidate
  } catch (error) {
    throw new Response(`storage is not reachable or not writable: ${errorMessage(error, 'unknown error')}`, {
      status: 400,
    })
  }
}

export async function buildStorageCandidate(config: StorageConfig, repository: Repository, workspaceId: string) {
  if (config.adapter === 'managed') return managedStorageCandidate(workspaceId)
  // Inventory the operator-visible location before buildAssetStore applies workspace namespacing.
  return await buildAssetStore(config, repository)
}

function managedStorageCandidate(workspaceId: string) {
  const managed = resolveManagedStorageConfig(workspaceId)
  if (!managed) throw new Response('managed storage is not configured', { status: 503 })
  return new S3AssetStore(managed)
}

export async function inspectStorageCandidate(candidate: AssetStore, missingIsEmpty = false) {
  try {
    return await candidate.inventory()
  } catch (error) {
    if (missingIsEmpty && ((error as { code?: string }).code === 'ENOENT' || (error as { status?: number }).status === 404))
      return emptyStorageInventory()
    throw new Response(`storage is writable but its contents cannot be inspected: ${errorMessage(error, 'unknown error')}`, { status: 400 })
  }
}

export function emptyStorageInventory() {
  return { files: 0, folders: 0, bytes: 0, entries: [], truncated: false }
}
