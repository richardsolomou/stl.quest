import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, '/api/health', async () => {
          try {
            const instance = await app()
            instance.repository.countUsers()
            const storage = instance.storageReady || (await instance.recoverStorage())
            if (!storage) throw new Error('storage is not ready')
            await Promise.all([instance.assets.writable(), instance.staging.writable()])
            instance.assetQueue.backfill()
            return Response.json({ ok: true, storage, assets: instance.assetQueue.stats() })
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : 'health check failed' }, { status: 503 })
          }
        }),
    },
  },
})
