import fs from 'node:fs'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { AssetStore, StorageConfig } from '../core/types'
import { hasInvalidRelativePathSegment } from '../core/storagePath'
import { assetContentType } from '../core/assetKeys'
import pRetry, { AbortError } from 'p-retry'
import { isRetryableError } from './retryableError'
import { prepareAssetMove } from './assetMove'
import { finalizeCloudUpload } from './finalizeCloudUpload'
import { AssetStoreKeys } from './assetStoreKeys'
import { StorageInventoryBuilder } from './storageInventory'

type S3Config = Extract<StorageConfig, { adapter: 's3' }>

// Object storage has no atomic rename, so moves are copy-then-delete. Asset
// keys embed a request UUID and are never reused for different content,
// which lets replay treat "source and destination both present with equal
// sizes" as an interrupted move/publish to finish, not a conflict.
export class S3AssetStore extends AssetStoreKeys implements AssetStore {
  private client: S3Client
  private bucket: string
  private prefix: string

  constructor(config: S3Config) {
    super()
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

  async finalizeUpload(stagedPath: string, relativePath: string) {
    await finalizeCloudUpload(
      stagedPath,
      relativePath,
      () => this.head(relativePath),
      (_stream, size, sourcePath) =>
        retryS3(() =>
          this.client.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: this.key(relativePath),
              Body: fs.createReadStream(sourcePath),
              ContentLength: size,
              ContentType: assetContentType(relativePath),
            }),
          ),
        ),
    )
  }

  async write(relativePath: string, bytes: Uint8Array) {
    await retryS3(() =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(relativePath),
          Body: bytes,
          ContentType: assetContentType(relativePath),
        }),
      ),
    )
  }

  async writeStream(relativePath: string, stream: ReadableStream, size: number) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(relativePath),
        Body: Readable.fromWeb(stream as import('node:stream/web').ReadableStream),
        ContentLength: size,
        ContentType: assetContentType(relativePath),
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

  async ensureMoved(sourcePath: string, destinationPath: string) {
    const move = await prepareAssetMove(
      sourcePath,
      destinationPath,
      (path) => this.head(path),
      (asset) => asset.size,
    )
    if (!move) return
    const { destination } = move
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

  async removeEmptyDirectory(relativePath: string) {
    const prefix = `${this.key(relativePath)}/`
    const page = await retryS3(() => this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 2 })))
    const contents = page.Contents ?? []
    if (contents.some((object) => object.Key !== prefix)) return false
    if (contents.some((object) => object.Key === prefix))
      await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: prefix })))
    return true
  }

  async trash(relativePath: string) {
    if (!(await this.head(relativePath))) return undefined
    const trashPath = this.temporaryTrashPath(relativePath)
    await this.ensureMoved(relativePath, trashPath)
    return trashPath
  }

  async sweepTrash() {
    const trashPrefix = `${this.prefix}.stlquest/trash/`
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
    const probe = this.key(`.stlquest/health-${crypto.randomUUID()}`)
    await retryS3(() => this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: probe, Body: new Uint8Array() })))
    await retryS3(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: probe })))
  }

  async inventory() {
    const inventory = new StorageInventoryBuilder()
    for (const object of await this.objects()) {
      const relative = object.Key!.slice(this.prefix.length)
      if (!relative || relative.endsWith('/')) continue
      inventory.addFile(relative, object.Size ?? 0)
      const segments = relative.split('/').slice(0, -1)
      for (let index = 1; index <= segments.length; index++) {
        const folder = segments.slice(0, index).join('/')
        inventory.addFolder(folder)
      }
    }
    return inventory.result()
  }

  async clear() {
    while (true) {
      const page = await retryS3(() =>
        this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, MaxKeys: 1_000 })),
      )
      const objects = (page.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []))
      if (objects.length === 0) return
      const deleted = await retryS3(() =>
        this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } })),
      )
      if (deleted.Errors?.length)
        throw new Error(`could not delete ${deleted.Errors.length} object${deleted.Errors.length === 1 ? '' : 's'}`)
    }
  }

  private async objects() {
    const objects: Array<{ Key?: string; Size?: number }> = []
    let token: string | undefined
    do {
      const page = await retryS3(() =>
        this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, ContinuationToken: token })),
      )
      objects.push(...(page.Contents ?? []))
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return objects
  }

  private key(relativePath: string) {
    if (hasInvalidRelativePathSegment(relativePath)) {
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

export function isNotFound(error: unknown) {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'NotFound' || candidate.name === 'NoSuchKey' || candidate.$metadata?.httpStatusCode === 404
}

function retryS3<T>(operation: () => Promise<T>) {
  return pRetry(
    async () => {
      try {
        return await operation()
      } catch (error) {
        if (!isRetryableError(error)) throw new AbortError(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
    },
    { retries: 3, minTimeout: 250, maxTimeout: 2_000 },
  )
}
