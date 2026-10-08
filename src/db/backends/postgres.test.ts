import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterEach, describe, expect, it } from 'vitest'
import { DrizzleRepository } from '../repository'
import { requests, user } from '../schema'
import { createAuth } from '../../server/auth'

describe.skipIf(!process.env.POSTGRES_TEST_URL)('PostgreSQLBackend', () => {
  let opened: DrizzleRepository | undefined

  afterEach(async () => await opened?.close())

  async function openEmptyRepository() {
    const url = process.env.POSTGRES_TEST_URL!
    if (!new URL(url).pathname.endsWith('_test')) throw new Error('POSTGRES_TEST_URL must name a database ending in _test')
    const client = postgres(url, { max: 1 })
    await client`DROP SCHEMA public CASCADE`
    await client`DROP SCHEMA IF EXISTS drizzle CASCADE`
    await client`CREATE SCHEMA public`
    await client.end()
    const previousUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = url
    let repository: DrizzleRepository
    try {
      repository = opened = await DrizzleRepository.open()
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
    return repository
  }

  it('runs migrations and repository transactions on PostgreSQL', async () => {
    const repository = await openEmptyRepository()
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
    const archivedIds = await repository.archiveRequestsStillDue([id], 1_000, (candidates) =>
      candidates.filter(({ counts }) => counts.in_progress === 1).map((candidate) => candidate.id),
    )
    expect({ archivedIds, archivedAt: (await repository.getRequest(id))?.archivedAt }).toEqual({ archivedIds: [id], archivedAt: 1_000 })
    expect(await repository.database.select().from(user).where(eq(user.id, 'maker')).get()).toMatchObject({ email: 'maker@example.com' })

    const auth = createAuth(repository.database, 'test-secret-0123456789abcdef0123456789abcdef')
    await expect(
      auth.api.signUpEmail({ body: { email: 'requester@example.com', password: 'password1234', name: 'Requester' } }),
    ).resolves.toMatchObject({ user: { email: 'requester@example.com' } })
  })

  it('keeps a print on the board when a copy leaves Ready while the archive re-check runs', async () => {
    const repository = await openEmptyRepository()
    const id = await repository.createRequest({
      name: 'Hook',
      fileName: 'hook.stl',
      filePath: 'todo/hook.stl',
      quantity: 1,
      ownerUserId: 'maker',
    })
    await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1 })
    const allReady = (candidates: { id: string; counts: Record<string, number> }[]) =>
      candidates.filter(({ counts }) => counts.done === 1 && counts.post_processing === 0).map((candidate) => candidate.id)

    let sweep: Promise<string[]> | undefined
    const override = <T extends object>(target: T, property: string, replacement: (original: Function) => unknown) =>
      new Proxy(target, {
        get: (object, key) => {
          const member = Reflect.get(object, key) as Function
          return key === property ? replacement(member.bind(object)) : member
        },
      })
    await repository.database.transaction(async (tx) => {
      // Run the real move, but start a sweep while the move holds its stage writes and has not yet written the request row.
      const paused = override(tx, 'update', (update) => (table: unknown) => {
        const builder = update(table)
        if (table !== requests) return builder
        return override(
          builder,
          'set',
          (set) => (fields: unknown) =>
            override(
              set(fields),
              'where',
              (where) => (condition: unknown) =>
                override(where(condition), 'run', (run) => async () => {
                  sweep = repository.archiveRequestsStillDue([id], 1_000, allReady)
                  await new Promise((resolve) => setTimeout(resolve, 300))
                  return await run()
                }),
            ),
        )
      })
      await repository.moveCopies({ id, from: 'done', to: 'post_processing', count: 1 }, paused)
    })

    const archivedIds = await sweep
    expect({ archivedIds, archivedAt: (await repository.getRequest(id))?.archivedAt }).toEqual({ archivedIds: [], archivedAt: undefined })
  })
})
