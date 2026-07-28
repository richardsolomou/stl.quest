import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Server, Upload } from '@tus/server'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createDistributedRuntime, type DistributedRuntime } from '../server/distributedRuntime'
import type { DistributedConfig } from '../server/distributed'

const endpoint = process.env.DISTRIBUTED_TEST_S3_ENDPOINT
const redisUrl = process.env.DISTRIBUTED_TEST_REDIS_URL
const describeDistributed = endpoint && redisUrl ? describe : describe.skip

describeDistributed('distributed uploads', () => {
  const bucket = `stlquest-${crypto.randomUUID()}`
  const config: DistributedConfig = {
    databaseUrl: 'postgresql://unused',
    redisUrl: redisUrl!,
    encryptionKey: Buffer.alloc(32, 1).toString('base64url'),
    staging: {
      bucket,
      region: 'us-east-1',
      endpoint,
      accessKeyId: process.env.DISTRIBUTED_TEST_S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.DISTRIBUTED_TEST_S3_SECRET_ACCESS_KEY!,
      forcePathStyle: true,
    },
  }
  let first: DistributedRuntime
  let second: DistributedRuntime

  beforeAll(async () => {
    const client = new S3Client({
      endpoint,
      region: config.staging.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.staging.accessKeyId!, secretAccessKey: config.staging.secretAccessKey! },
    })
    await client.send(new CreateBucketCommand({ Bucket: bucket }))
    ;[first, second] = await Promise.all([createDistributedRuntime(config), createDistributedRuntime(config)])
  })

  afterAll(async () => {
    await Promise.all([first?.close(), second?.close()])
  })

  it('finishes an upload on a different replica', async () => {
    const upload = await first.datastore.create(new Upload({ id: crypto.randomUUID(), size: 3, offset: 0 }))
    await first.datastore.write(Readable.from([Buffer.from('stl')]), upload.id, 0)
    let written = ''
    const assets = {
      stat: async () => undefined,
      writeStream: async (_path: string, stream: ReadableStream) => {
        for await (const chunk of Readable.fromWeb(stream as import('node:stream/web').ReadableStream)) written += chunk.toString()
      },
    }

    await second.staging.finalizeUpload(upload.id, upload.id, 'todo/model.stl', assets as never)

    expect(written).toBe('stl')
  })

  it('accepts a TUS upload created and finished through different replicas', async () => {
    const finished = vi.fn()
    const firstServer = new Server({ path: '/api/upload', datastore: first.datastore, locker: first.locker })
    const secondServer = new Server({
      path: '/api/upload',
      datastore: second.datastore,
      locker: second.locker,
      onUploadFinish: async (_request, upload) => {
        finished(upload.id)
        return {}
      },
    })
    const created = await firstServer.handleWeb(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '3' },
      }),
    )
    const location = created.headers.get('Location')
    expect(location).toBeTruthy()

    const completed = await secondServer.handleWeb(
      new Request(new URL(location!, 'http://localhost'), {
        method: 'PATCH',
        headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
        body: 'stl',
        duplex: 'half',
      } as RequestInit),
    )

    expect({ status: completed.status, body: await completed.text() }).toEqual({ status: 204, body: '' })
    expect(finished).toHaveBeenCalledOnce()
  })

  it('serializes work across replicas', async () => {
    const firstLock = first.workLocker.newLock('same-job')
    const secondLock = second.workLocker.newLock('same-job')
    await firstLock.lock(new AbortController().signal, () => undefined)
    let acquired = false
    const waiting = secondLock
      .lock(new AbortController().signal, () => undefined)
      .then(() => {
        acquired = true
      })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(acquired).toBe(false)
    await firstLock.unlock()
    await waiting
    await secondLock.unlock()
  })

  it('shares board presence across replicas', async () => {
    const snapshots: { id: string }[][] = []
    const leaveFirst = await first.presence.join('workspace', { id: 'first', name: 'First', image: null } as never, (viewers) =>
      snapshots.push(viewers),
    )
    const leaveSecond = await second.presence.join('workspace', { id: 'second', name: 'Second', image: null } as never)
    await vi.waitFor(() => expect(snapshots.at(-1)?.map(({ id }) => id)).toEqual(['first', 'second']))

    leaveSecond()
    await vi.waitFor(() => expect(snapshots.at(-1)?.map(({ id }) => id)).toEqual(['first']))
    leaveFirst()
  })

  it('delivers workspace events across replicas without crossing workspaces', async () => {
    const received = vi.fn()
    const otherWorkspace = vi.fn()
    const secondBus = second.events.bus('events-workspace')
    secondBus.subscribe(received)
    second.events.bus('other-workspace').subscribe(otherWorkspace)
    await Promise.all([second.events.ready('events-workspace'), second.events.ready('other-workspace')])

    first.events.bus('events-workspace').publish('request.created')

    await vi.waitFor(() => expect(received).toHaveBeenCalledExactlyOnceWith('request.created'))
    expect(otherWorkspace).not.toHaveBeenCalled()
  })
})
