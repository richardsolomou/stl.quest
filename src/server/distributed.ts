export type DistributedConfig = {
  databaseUrl: string
  redisUrl: string
  encryptionKey: string
  staging: {
    bucket: string
    region: string
    endpoint?: string
    accessKeyId?: string
    secretAccessKey?: string
    forcePathStyle: boolean
  }
}

export function resolveDistributedConfig(environment: NodeJS.ProcessEnv = process.env): DistributedConfig | undefined {
  if (environment.STLQUEST_DISTRIBUTED?.trim() !== 'true') return undefined

  const databaseUrl = required(environment, 'DATABASE_URL')
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error('distributed mode requires a PostgreSQL DATABASE_URL')

  const redisUrl = required(environment, 'REDIS_URL')
  const parsedRedisUrl = new URL(redisUrl)
  if (parsedRedisUrl.protocol !== 'redis:' && parsedRedisUrl.protocol !== 'rediss:') {
    throw new Error('REDIS_URL must use redis:// or rediss://')
  }

  const endpoint = environment.STAGING_S3_ENDPOINT?.trim() || undefined
  if (endpoint) {
    const parsedEndpoint = new URL(endpoint)
    if (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') {
      throw new Error('STAGING_S3_ENDPOINT must use http:// or https://')
    }
  }

  const accessKeyId = environment.STAGING_S3_ACCESS_KEY_ID?.trim() || undefined
  const secretAccessKey = environment.STAGING_S3_SECRET_ACCESS_KEY?.trim() || undefined
  if (!!accessKeyId !== !!secretAccessKey) {
    throw new Error('STAGING_S3_ACCESS_KEY_ID and STAGING_S3_SECRET_ACCESS_KEY must be configured together')
  }

  const encryptionKey = required(environment, 'INTEGRATIONS_ENCRYPTION_KEY')
  const decodedKey = Buffer.from(encryptionKey, 'base64url')
  if (decodedKey.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be a base64url-encoded 32-byte key')

  return {
    databaseUrl,
    redisUrl,
    encryptionKey,
    staging: {
      bucket: required(environment, 'STAGING_S3_BUCKET'),
      region: required(environment, 'STAGING_S3_REGION'),
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: environment.STAGING_S3_FORCE_PATH_STYLE?.trim() === 'true',
    },
  }
}

export function assertDistributedWorkspaceReadiness(
  workspaces: { slug: string; localStorageInUse: boolean; activeUploads: number; storageMigrationRunning: boolean }[],
) {
  const local = workspaces.filter((workspace) => workspace.localStorageInUse).map((workspace) => workspace.slug)
  if (local.length) throw new Error(`distributed mode requires remote storage for every workspace: ${local.join(', ')}`)
  const migrating = workspaces.filter((workspace) => workspace.storageMigrationRunning).map((workspace) => workspace.slug)
  if (migrating.length) throw new Error(`finish storage migrations before enabling distributed mode: ${migrating.join(', ')}`)
  const uploading = workspaces.filter((workspace) => workspace.activeUploads > 0).map((workspace) => workspace.slug)
  if (uploading.length) throw new Error(`finish or cancel active uploads before enabling distributed mode: ${uploading.join(', ')}`)
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim()
  if (!value) throw new Error(`${name} is required in distributed mode`)
  return value
}
