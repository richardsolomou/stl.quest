import fs from 'node:fs'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import { convex, writeSecret } from '../../server/convexServer'
import { readUserEmail } from '../../server/identity'
import { absolutePath, ensureStatusFolders, newRelativePath } from '../../server/files'

const MAX_FILE_BYTES = 95 * 1024 * 1024 // Cloudflare free-plan proxy caps request bodies at 100 MB
const MAX_THUMBNAIL_CHARS = 300_000

function bad(message: string): Response {
  return Response.json({ error: message }, { status: 400 })
}

export const Route = createFileRoute('/api/upload')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const email = readUserEmail()
        const form = await request.formData()

        const file = form.get('file')
        if (!(file instanceof File)) return bad('missing file')
        if (!/\.stl$/i.test(file.name)) return bad('only .stl files are accepted')
        if (file.size === 0) return bad('file is empty')
        if (file.size > MAX_FILE_BYTES) return bad('file is too large (max 95 MB)')

        const name = String(form.get('name') ?? '').trim().slice(0, 120)
        if (!name) return bad('missing name')

        const quantity = Number(form.get('quantity'))
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
          return bad('quantity must be between 1 and 50')
        }

        // Explicit "For" wins; otherwise the uploader's mapped name from the users table.
        const requesterName =
          String(form.get('requesterName') ?? '').trim().slice(0, 60) ||
          (await convex().query(api.users.byEmail, { email }))?.name ||
          undefined
        const notes = String(form.get('notes') ?? '').trim().slice(0, 2000) || undefined

        const thumbnailRaw = String(form.get('thumbnail') ?? '')
        const thumbnail =
          thumbnailRaw.startsWith('data:image/') && thumbnailRaw.length <= MAX_THUMBNAIL_CHARS
            ? thumbnailRaw
            : undefined

        await ensureStatusFolders()
        const relativePath = newRelativePath(file.name)
        const destination = absolutePath(relativePath)
        await fs.promises.writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: 'wx' })

        try {
          const id = await convex().mutation(api.jobs.create, {
            secret: writeSecret(),
            name,
            fileName: file.name,
            filePath: relativePath,
            quantity,
            requesterEmail: email,
            requesterName,
            notes,
            thumbnail,
          })
          return Response.json({ id })
        } catch (error) {
          await fs.promises.rm(destination, { force: true })
          throw error
        }
      },
    },
  },
})
