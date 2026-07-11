import fs from 'node:fs'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { convex } from '../../server/convexServer'
import { readUserEmail } from '../../server/identity'
import { absolutePath } from '../../server/files'

export const Route = createFileRoute('/api/files/$jobId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        readUserEmail()
        const job = await convex().query(api.jobs.get, { id: params.jobId as Id<'jobs'> })
        if (!job) return new Response('not found', { status: 404 })

        const filePath = absolutePath(job.filePath)
        let size: number
        try {
          size = (await fs.promises.stat(filePath)).size
        } catch {
          return new Response('file missing on disk', { status: 404 })
        }

        const headers = new Headers({
          'Content-Type': 'model/stl',
          'Content-Length': String(size),
        })
        if (new URL(request.url).searchParams.get('inline') !== '1') {
          const safeName = job.fileName.replace(/["\r\n]/g, '')
          headers.set('Content-Disposition', `attachment; filename="${safeName}"`)
        }
        return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, { headers })
      },
    },
  },
})
