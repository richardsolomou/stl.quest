import path from 'node:path'
import type { StorageConfig } from '../core/types'

export function resolveStorageInput(data: StorageConfig, current: StorageConfig): StorageConfig {
  if (data.adapter === 'managed') return data
  if (data.adapter === 'local') return { adapter: 'local', root: path.resolve(data.root) }
  if (data.adapter === 'dropbox' || data.adapter === 'google-drive' || data.adapter === 'onedrive') {
    const root = normalizedFolder(data.root, 'invalid cloud storage folder')
    return { adapter: data.adapter, root }
  }
  if (data.adapter === 'webdav') {
    const password = data.password || (current.adapter === 'webdav' ? current.password : '')
    if (!password) throw new Response('missing WebDAV password', { status: 400 })
    return {
      adapter: 'webdav',
      endpoint: data.endpoint,
      root: normalizedFolder(data.root.trim(), 'invalid WebDAV folder'),
      username: data.username,
      password,
    }
  }
  const secretAccessKey = data.secretAccessKey || (current.adapter === 's3' ? current.secretAccessKey : '')
  if (!secretAccessKey) throw new Response('missing secret access key', { status: 400 })
  const prefix = data.prefix?.trim().replace(/^\/+|\/+$/g, '') ?? ''
  if (prefix.length > 200 || hasTraversalSegment(prefix)) throw new Response('invalid prefix', { status: 400 })
  return {
    adapter: 's3',
    endpoint: data.endpoint,
    region: data.region,
    bucket: data.bucket,
    prefix: prefix || undefined,
    accessKeyId: data.accessKeyId,
    secretAccessKey,
    forcePathStyle: data.forcePathStyle,
  }
}

export function storageConfigChanged(current: StorageConfig, next: StorageConfig) {
  if (storageLocationChanged(current, next)) return true
  if (current.adapter === 'webdav' && next.adapter === 'webdav')
    return current.username !== next.username || current.password !== next.password
  if (current.adapter === 's3' && next.adapter === 's3')
    return (
      current.region !== next.region ||
      current.accessKeyId !== next.accessKeyId ||
      current.secretAccessKey !== next.secretAccessKey ||
      current.forcePathStyle !== next.forcePathStyle
    )
  return false
}

export function storageChangeRequiresMigration(current: StorageConfig, next: StorageConfig, storageHasActivity: boolean) {
  return storageHasActivity && storageLocationChanged(current, next)
}

export function storageLocationChanged(current: StorageConfig, next: StorageConfig) {
  if (current.adapter !== next.adapter) return true
  if (current.adapter === 'managed') return false
  if (current.adapter === 'local') return next.adapter !== 'local' || current.root !== next.root
  if (current.adapter === 'dropbox') return next.adapter !== 'dropbox' || current.root !== next.root
  if (current.adapter === 'google-drive') return next.adapter !== 'google-drive' || current.root !== next.root
  if (current.adapter === 'onedrive') return next.adapter !== 'onedrive' || current.root !== next.root
  if (current.adapter === 'webdav') return next.adapter !== 'webdav' || current.endpoint !== next.endpoint || current.root !== next.root
  return (
    next.adapter !== 's3' ||
    current.endpoint !== next.endpoint ||
    current.bucket !== next.bucket ||
    (current.prefix ?? '') !== (next.prefix ?? '')
  )
}

function normalizedFolder(value: string, message: string) {
  const folder = value.replace(/^\/+|\/+$/g, '')
  if (hasTraversalSegment(folder)) throw new Response(message, { status: 400 })
  return folder
}

function hasTraversalSegment(value: string) {
  return value.split('/').some((segment) => segment === '.' || segment === '..')
}
