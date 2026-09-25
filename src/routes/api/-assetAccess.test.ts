import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDatabase } from '../../db/connection'
import { DrizzleRepository } from '../../db/repository'
import { user } from '../../db/schema'
import { app } from '../../server/app'
import { Route as fileRoute } from './files.$requestId'
import { Route as batchRoute } from './files.batch'
import { Route as thumbnailRoute } from './thumbs.$requestId'
import { Route as sourceImageRoute } from './source-images.$requestId'

vi.mock('../../server/app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/app')>()),
  app: vi.fn(),
}))

const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
type RequestIds = Record<'owned' | 'second' | 'private' | 'foreign', string>
let repository: DrizzleRepository
let requestIds: RequestIds

type GetHandler = (input: { request: Request; params: { requestId: string } }) => Promise<Response>

function getHandler(route: unknown) {
  return (route as { options: { server?: { handlers?: { GET?: unknown } } } }).options.server?.handlers?.GET
}

const routes = [
  { name: 'model', handler: getHandler(fileRoute), path: (id: string, _ids: RequestIds) => `/api/files/${id}?inline=1` },
  { name: 'thumbnail', handler: getHandler(thumbnailRoute), path: (id: string, _ids: RequestIds) => `/api/thumbs/${id}` },
  {
    name: 'source image',
    handler: getHandler(sourceImageRoute),
    path: (id: string, _ids: RequestIds) => `/api/source-images/${id}`,
  },
  {
    name: 'batch',
    handler: getHandler(batchRoute),
    path: (id: string, ids: RequestIds) => `/api/files/batch?id=${ids.owned}&id=${id === ids.owned ? ids.second : id}`,
  },
] as const

beforeEach(async () => {
  repository = await DrizzleRepository.create(createDatabase(':memory:'))
  const now = new Date()
  for (const id of ['viewer', 'other']) {
    await repository.database
      .insert(user)
      .values({ id, name: id, email: `${id}@example.com`, role: 'requester', emailVerified: true, createdAt: now, updatedAt: now })
      .run()
    await repository.addWorkspaceMember(id, 'member')
  }
  const primary = await repository.scoped('test-workspace')
  const secondaryWorkspace = await repository.createWorkspace({ id: 'viewer' }, 'Second workspace')
  const secondary = await repository.scoped(secondaryWorkspace.id)
  await primary.setSetting('board', { privateRequests: true })
  const createRequest = (ownerUserId: string, name: string, workspace: DrizzleRepository) =>
    workspace.createRequest({
      name,
      ownerUserId,
      quantity: 1,
      fileName: 'model.stl',
      filePath: 'model.stl',
      thumbnailPath: 'thumbnail.png',
      sourceImageUrl: 'https://makerworld.bblmw.com/cover.png',
    })
  requestIds = {
    owned: await createRequest('viewer', 'Owned', primary),
    second: await createRequest('viewer', 'Second', primary),
    private: await createRequest('other', 'Private', primary),
    foreign: await createRequest('viewer', 'Foreign', secondary),
  }
  vi.mocked(app).mockResolvedValue({
    telemetry: { capture: async () => undefined },
    workspace: async () => ({
      identity: { id: 'viewer', role: 'requester' },
      repository: primary,
      service: {
        getRequest: (id: string) => primary.getRequest(id),
        cachedSourceImage: async () => image,
      },
      assets: { read: async () => ({ stream: new Blob([image]).stream(), size: image.byteLength }) },
    }),
  } as never)
})

afterEach(async () => {
  await repository.close()
})

async function get(handler: unknown, path: string) {
  if (typeof handler !== 'function') throw new Error('missing GET handler')
  const url = new URL(path, 'http://localhost')
  return await (handler as GetHandler)({
    request: new Request(url),
    params: { requestId: url.pathname.split('/').at(-1) ?? '' },
  })
}

it('asset routes enforce request visibility', async () => {
  const actual = []
  for (const route of routes) {
    for (const requestId of ['owned', 'private', 'foreign'] as const) {
      const response = await get(route.handler, route.path(requestIds[requestId], requestIds))
      actual.push({ route: route.name, requestId, status: response.status })
      if (response.ok) await response.arrayBuffer()
    }
  }
  expect(actual).toEqual(
    routes.flatMap(({ name }) => [
      { route: name, requestId: 'owned', status: 200 },
      { route: name, requestId: 'private', status: 404 },
      { route: name, requestId: 'foreign', status: 404 },
    ]),
  )
})
