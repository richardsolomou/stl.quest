import { createFileRoute } from '@tanstack/react-router'
import { assetContentType } from '../../core/assetKeys'
import { plateFileName } from '../../core/plates'
import { taggedFileName } from '../../core/request'
import { app } from '../../server/app'
import { assetResponse, attachmentDisposition } from '../../server/assetDownloads'
import { authorizedRequestAsset, requestPrintType } from '../../server/requestAssetAccess'
import { withRequestContext } from '../../server/requestContext'
import { checkedPlateModels, PlateModelError, type PlateFiles } from '../../server/plateFile'
import { serverMessages } from '../../server/locale'

type App = Awaited<ReturnType<typeof app>>

/** Every refusal is the same 404 as a bad link, so a link says nothing about what it names once it stops working. */
async function plateFile(instance: App, context: NonNullable<Awaited<ReturnType<App['slicerLinkWorkspace']>>>, plateId: string) {
  let checked: Awaited<ReturnType<typeof checkedPlateModels>>
  try {
    checked = await checkedPlateModels(context, plateId)
  } catch (error) {
    if (error instanceof Response) return new Response('not found', { status: 404 })
    throw error
  }
  let file: Awaited<ReturnType<PlateFiles['open']>>
  try {
    file = await context.plateFiles.open(plateId, checked.models)
  } catch (error) {
    if (error instanceof PlateModelError)
      return new Response(serverMessages().server.plates.unconvertible(error.model.name), { status: 422 })
    throw error
  }
  instance.telemetry.capture(context.identity.id, 'slicer_plate_served', {
    request_count: checked.models.length,
    copy_count: checked.copies,
  })
  return new Response(file.stream, {
    headers: {
      'Content-Type': assetContentType('plate.3mf'),
      'Content-Disposition': attachmentDisposition(
        plateFileName(
          checked.plate.number,
          checked.models.map(({ name }) => name),
        ),
      ),
      'Content-Length': String(file.size),
      'Cache-Control': 'private, no-store',
    },
  })
}

// A slicer fetches this without the browser session, so the signed link stands in for it: it names one request or plate
// in one workspace for the member who asked, and that member must still be able to see it when it is fetched.
export const Route = createFileRoute('/api/slicer/$payload/$signature')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withRequestContext(
          request,
          async () => {
            const instance = await app()
            const context = await instance.slicerLinkWorkspace(params.payload, params.signature)
            if (!context) return new Response('not found', { status: 404 })
            if ('plateId' in context.link) return await plateFile(instance, context, context.link.plateId)
            const printRequest = await authorizedRequestAsset(context, context.link.requestId)
            if (!printRequest?.filePath || !printRequest.fileName) return new Response('not found', { status: 404 })
            let asset: { stream: ReadableStream; size: number }
            try {
              asset = await context.assets.read(printRequest.filePath)
            } catch {
              return new Response('file missing in storage', { status: 404 })
            }
            instance.telemetry.capture(context.identity.id, 'slicer_file_served', {
              print_type: await requestPrintType(context.repository, printRequest),
            })
            const headers = new Headers({
              'Content-Type': assetContentType(printRequest.filePath),
              'Content-Disposition': attachmentDisposition(taggedFileName(printRequest.number, printRequest.fileName)),
              'Cache-Control': 'private, no-store',
            })
            return assetResponse(request, asset, headers)
          },
          '/api/slicer/…',
        ),
    },
  },
})
