import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'
import { DrizzleRepository } from '../repository'
import { user } from '../schema'
import { createAuth } from '../../server/auth'

describe.skipIf(!process.env.POSTGRES_TEST_URL)('PostgreSQLBackend', () => {
  let repository: DrizzleRepository | undefined

  afterEach(async () => await repository?.close())

  it('runs migrations and repository transactions on PostgreSQL', async () => {
    const url = process.env.POSTGRES_TEST_URL!
    if (!new URL(url).pathname.endsWith('_test')) throw new Error('POSTGRES_TEST_URL must name a database ending in _test')
    const client = postgres(url, { max: 1 })
    await client`DROP SCHEMA public CASCADE`
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await client`CREATE SCHEMA public`
    await client.end()
    const previousUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = url
    try {
      repository = await DrizzleRepository.open()
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousUrl
    }
    const now = new Date()
    await repository.database
      .insert(user)
      .values({
        id: 'maker',
        name: 'Maker',
        email: 'maker@example.com',
        emailVerified: true,
        role: 'requester',
        createdAt: now,
        updatedAt: now,
      })
      .run()
    await repository.addWorkspaceMember('maker', 'member')

    const id = await repository.createRequest({
      name: 'Bracket',
      fileName: 'bracket.stl',
      filePath: 'todo/bracket.stl',
      quantity: 3,
      ownerUserId: 'maker',
    })
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2, filePath: 'todo/bracket.stl' })

    expect(await repository.getRequest(id)).toMatchObject({
      counts: { todo: 1, up_next: 0, in_progress: 2, post_processing: 0, done: 0 },
    })
    expect(await repository.requestsNeedingAssets()).toEqual([id])
    await expect(repository.queryRequests({ filters: { query: 'bracket' } })).resolves.toMatchObject({ requests: [{ id }] })

    await repository.deleteCopiesBatch([{ id, status: 'in_progress', count: 1, deleteRequest: false }])
    expect(await repository.getRequest(id)).toMatchObject({
      quantity: 2,
      counts: { todo: 1, up_next: 0, in_progress: 1, post_processing: 0, done: 0 },
    })
    expect(await repository.database.select().from(user).where(eq(user.id, 'maker')).get()).toMatchObject({ email: 'maker@example.com' })

    const auth = createAuth(repository.database, 'test-secret-0123456789abcdef0123456789abcdef')
    await expect(
      auth.api.signUpEmail({ body: { email: 'requester@example.com', password: 'password1234', name: 'Requester' } }),
    ).resolves.toMatchObject({ user: { email: 'requester@example.com' } })
  })
})
