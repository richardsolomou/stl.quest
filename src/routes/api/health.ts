import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withRequestContext(request, async () => {
          try {
            const instance = await app()
            instance.repository.countUsers()
            if (instance.repository.listWorkspaces().length === 0) {
              await instance.staging.writable()
              return Response.json({ ok: true, storage: false, assets: null })
            }
            const runtime = await instance.defaultWorkspaceRuntime()
            const storage = runtime.storageReady || (await runtime.recoverStorage())
            if (!storage) throw new Error('storage is not ready')
            await Promise.all([runtime.assets.writable(), instance.staging.writable()])
            runtime.assetQueue.backfill()
            return Response.json({ ok: true, storage, assets: runtime.assetQueue.stats() })
          } catch (error) {
            return Response.json({ ok: false, error: error instanceof Error ? error.message : 'health check failed' }, { status: 503 })
          }
        }),
    },
  },
})
