import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { DrizzleRepository } from '../src/db/repository'
import { user } from '../src/db/schema'
import { createAuth } from '../src/server/auth'

export const PREVIEW_EMAIL = 'preview@stl.quest'
export const PREVIEW_PASSWORD = 'preview-preview-preview'

const requests = [
  { name: 'Calibration cube', printType: 'resin' as const, quantity: 1 },
  { name: 'Replacement bracket', printType: 'filament' as const, quantity: 2 },
  { name: 'Tabletop miniatures', printType: 'resin' as const, quantity: 4 },
]

export async function seedPreview() {
  const repository = await DrizzleRepository.open()
  try {
    let owner = await repository.database.select().from(user).where(eq(user.email, PREVIEW_EMAIL)).get()
    if (!owner) {
      const auth = createAuth(repository.database, 'stlquest-disposable-preview-secret', {
        baseURL: 'http://preview.local',
        trustedOrigins: ['http://preview.local'],
      })
      await auth.api.signUpEmail({ body: { email: PREVIEW_EMAIL, password: PREVIEW_PASSWORD, name: 'Preview owner' } })
      owner = await repository.database.select().from(user).where(eq(user.email, PREVIEW_EMAIL)).get()
    }
    if (!owner) throw new Error('preview owner was not created')

    const existingWorkspace = (await repository.listWorkspaces()).find((workspace) => workspace.slug === 'preview-workspace')
    const workspace =
      existingWorkspace ??
      (await repository.createWorkspace({ id: owner.id }, 'Preview workspace', {
        storage: { adapter: 'local', root: path.resolve(process.env.PRINTS_DIR ?? '/prints') },
        printers: [],
      }))
    const scoped = await repository.scoped(workspace.id)
    const existingNames = new Set((await scoped.listRequests()).map((request) => request.name))
    for (const request of requests) {
      if (existingNames.has(request.name)) continue
      const fileName = `${request.name.toLowerCase().replaceAll(' ', '-')}.stl`
      const filePath = `todo/${fileName}`
      const destination = path.join(process.env.PRINTS_DIR ?? '/prints', workspace.id, filePath)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, boxStl(request.name))
      await scoped.createRequest({
        name: request.name,
        fileName,
        filePath,
        quantity: request.quantity,
        ownerUserId: owner.id,
        requestedPrintType: request.printType,
      })
    }
  } finally {
    await repository.close()
  }
}

function boxStl(name: string) {
  return `solid ${name}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid ${name}\n`
}

if (import.meta.url === `file://${process.argv[1]}`) await seedPreview()
