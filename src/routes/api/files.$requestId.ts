import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { app } from '../../server/app'
import { withRequestContext } from '../../server/requestContext'
import { authorizedRequestAsset } from '../../server/requestAssetAccess'
import { storedPrinterProfiles } from '../../core/printers'

export const Route = createFileRoute('/api/files/$requestId')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(request, async () => {
          const instance = await app()
          const context = await instance.workspace(request.headers)
          const printRequest = await authorizedRequestAsset(context, params.requestId)
          if (!printRequest) return new Response('not found', { status: 404 })

          const url = new URL(request.url)
          const wantPreview = url.searchParams.get('preview') === '1'
          const relativePath = wantPreview && printRequest.previewPath ? printRequest.previewPath : printRequest.filePath
          let asset: { stream: ReadableStream; size: number }
          try {
            asset = await context.assets.read(relativePath)
          } catch {
            return new Response('file missing in storage', { status: 404 })
          }

          const currentPreview = wantPreview && relativePath.toLowerCase().endsWith('.phm')
          const headers = new Headers({
            'Content-Type': currentPreview ? 'application/octet-stream' : 'model/stl',
            'Cache-Control': wantPreview ? 'private, no-cache' : 'private, max-age=31536000, immutable',
            // Uncompressed size, so the client can show progress across gzip.
            'X-File-Size': String(asset.size),
          })
          if (url.searchParams.get('inline') !== '1') {
            const safeName = printRequest.fileName.replace(/["\r\n]/g, '')
            headers.set('Content-Disposition', `attachment; filename="${safeName}"`)
            const assignedPrinter = printRequest.printerId
              ? (await storedPrinterProfiles(context.repository)).find(({ id }) => id === printRequest.printerId)
              : undefined
            void instance.telemetry
              .capture(context.identity.id, 'stl_download_served', {
                print_type: assignedPrinter?.printType ?? printRequest.requestedPrintType,
              })
              .catch(() => undefined)
          }

          // Mesh data gzips well; fastest level keeps NAS CPU cheap.
          if ((request.headers.get('accept-encoding') ?? '').includes('gzip')) {
            headers.set('Content-Encoding', 'gzip')
            const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })
            return new Response(
              Readable.toWeb(Readable.fromWeb(asset.stream as Parameters<typeof Readable.fromWeb>[0]).pipe(gzip)) as ReadableStream,
              { headers },
            )
          }
          headers.set('Content-Length', String(asset.size))
          return new Response(asset.stream, { headers })
        }),
    },
  },
})
