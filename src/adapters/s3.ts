import fs from 'node:fs'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { AssetStore, StorageConfig } from '../core/types'
import { createAssetKey, destinationKey, previewKey, trashKey } from '../core/assetKeys'
import pRetry, { AbortError } from 'p-retry'

type S3Config = Extract<StorageConfig, { adapter: 's3' }>

// Object storage has no atomic rename, so moves are copy-then-delete. Asset
// keys embed a timestamp and UUID and are never reused for different content,
// which lets replay treat "source and destination both present with equal
// sizes" as an interrupted move/publish to finish, not a conflict.
export class S3AssetStore implements AssetStore {
  private client: S3Client
  private bucket: string
  private prefix: string

  constructor(config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
    })
    this.bucket = config.bucket
    this.prefix = config.prefix ? `${config.prefix.replace(/^\/+|\/+$/g, '')}/` : ''
  }

  async initialize() {}

  createPath(originalFileName: string) {
    return createAssetKey(originalFileName)
  }

  previewPath(originalRelativePath: string) {
    return previewKey(originalRelativePath)
  }

  destinationPath(relativePath: string, statusId: string) {
    return destinationKey(relativePath, statusId)
  }

  trashPath(operationId: string, relativePath: string) {
    return trashKey(operationId, relativePath)
  }

  async finalizeUpload(stagedPath: string, relativePath: string) {
    const [staged, destination] = await Promise.all([
      fs.promises.stat(stagedPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      }),
      this.head(relativePath),
    ])
    if (!staged && destination) return
    if (!staged) throw Object.assign(new Error(`upload part missing: ${stagedPath}`), { code: 'ENOENT' })
    if (destination) {
      if (destination.size !== staged.size) throw new Error(`upload destination already exists: ${relativePath}`)
    } else {
      await retryS3(() =>
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: this.key(relativePath),
            Body: fs.createReadStream(stagedPath),
            ContentLength: staged.size,
          }),
        ),
      )
    }
    await fs.promises.rm(stagedPath, { force: true })
  }

  async write(relativePath: string, bytes: Uint8Array) {
    await retryS3(() => this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath), Body: bytes })))
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(relativePath),
        Body: Readable.fromWeb(stream as import('node:stream/web').ReadableStream),
        ContentLength: size,
      }),
    )
  }

  async read(relativePath: string) {
    const result = await retryS3(() => this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) })))
    if (!result.Body) throw new Error(`empty object: ${relativePath}`)
    return { stream: result.Body.transformToWebStream(), size: result.ContentLength ?? 0 }
  }

  async stat(relativePath: string) {
    return this.head(relativePath)
  }

  async move(relativePath: string, statusId: string) {
    const next = this.destinationPath(relativePath, statusId)
    await this.ensureMoved(relativePath, next)
    return next
  }

  async ensureMoved(sourcePath: string, destinationPath: string) {
    if (sourcePath === destinationPath) return
    const [source, destination] = await Promise.all([this.head(sourcePath), this.head(destinationPath)])
    if (!source && destination) return
    if (!source) throw Object.assign(new Error(`asset missing: ${sourcePath}`), { code: 'ENOENT' })
    if (destination && destination.size !== source.size) throw new Error(`asset destination already exists: ${destinationPath}`)
    if (!destination) {
      await retryS3(() =>
        this.client.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            Key: this.key(destinationPath),
            CopySource: encodeURIComponent(`${this.bucket}/${this.key(sourcePath)}`),
          }),
        ),
      )
    }
    await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(sourcePath) })))
  }

  async exists(relativePath: string) {
    return !!(await this.head(relativePath))
  }

  async remove(relativePath: string) {
    await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) })))
  }

  async trash(relativePath: string) {
    if (!(await this.head(relativePath))) return undefined
    const trashPath = `.printhub/trash/${crypto.randomUUID()}__${relativePath.split('/').pop()}`
    await this.ensureMoved(relativePath, trashPath)
    return trashPath
  }

  async purgeTrash(trashPath: string) {
    await this.remove(trashPath)
  }

  async sweepTrash() {
    const trashPrefix = `${this.prefix}.printhub/trash/`
    let token: string | undefined
    do {
      const page = await retryS3(() =>
        this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: trashPrefix, ContinuationToken: token })),
      )
      for (const object of page.Contents ?? []) {
        if (object.Key) await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: object.Key })))
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  }

  async writable() {
    const probe = this.key(`.printhub/health-${crypto.randomUUID()}`)
    await retryS3(() => this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: probe, Body: new Uint8Array() })))
    await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: probe })))
  }

  private key(relativePath: string) {
    if (relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Response('invalid path', { status: 400 })
    }
    return this.prefix + relativePath
  }

  private async head(relativePath: string) {
    try {
      const result = await retryS3(() => this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) })))
      return { size: result.ContentLength ?? 0 }
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }
}

function isNotFound(error: unknown) {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
}

function retryS3<T>(operation: () => Promise<T>) {
  return pRetry(
    async () => {
      try {
        return await operation()
      } catch (error) {
        if (!isRetryableS3Error(error)) throw new AbortError(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
    },
    { retries: 3, minTimeout: 250, maxTimeout: 2_000 },
  )
}

export function isRetryableS3Error(error: unknown) {
  const candidate = error as { name?: string; $retryable?: unknown; $metadata?: { httpStatusCode?: number } }
  const status = candidate.$metadata?.httpStatusCode
  return (
    !!candidate.$retryable ||
    candidate.name === 'TimeoutError' ||
    candidate.name === 'NetworkingError' ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500)
  )
}
