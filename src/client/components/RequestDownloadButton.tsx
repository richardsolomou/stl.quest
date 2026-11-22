import { usePostHog } from '@posthog/react'
import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button, ButtonLink } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '../../core/error'
import type { Slicer } from '../../core/slicers'
import type { PublicPrintRequest } from '../../core/types'
import { createSlicerLink } from '../../server/fns'
import { requestDownloadHref } from '../boardDownload'
import { signalProductTourProgress } from '../productTour'
import { slicerFileUrl, usePrinterSlicer } from '../printerSlicer'
import { useI18n } from '../i18n'
import { useWorkspaceSlug } from '../workspace'

export function RequestDownloadButton({ request, isAdmin }: { request: PublicPrintRequest; isAdmin: boolean }) {
  const { t } = useI18n()
  const posthog = usePostHog()
  const slicer = usePrinterSlicer(request.printer?.id, isAdmin)
  return (
    <>
      {slicer?.openUrl && <OpenInSlicerButton request={request} slicer={slicer} openUrl={slicer.openUrl} />}
      <ButtonLink
        variant="outline"
        href={requestDownloadHref([request])}
        download
        onClick={() => {
          posthog.capture('stl_downloaded', { print_type: request.printType })
          signalProductTourProgress('download')
        }}
      >
        {slicer && !slicer.openUrl ? t.requests.slicer.download(slicer.name) : t.requests.downloadModel}
      </ButtonLink>
    </>
  )
}

/** Hands the slicer a signed link to fetch the model itself, since it has no browser session. */
function OpenInSlicerButton({
  request,
  slicer,
  openUrl,
}: {
  request: PublicPrintRequest
  slicer: Slicer
  openUrl: (fileUrl: string) => string
}) {
  const { t } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const callCreateLink = useServerFn(createSlicerLink)
  const open = useMutation({
    mutationFn: () => callCreateLink({ data: { workspaceSlug, requestId: request.id, slicer: slicer.id } }),
    onSuccess: ({ path }) => {
      window.location.href = openUrl(slicerFileUrl(path))
      toast(t.requests.slicer.opening(slicer.name), {
        description: request.modelFormat === '3mf' ? t.requests.slicer.opensProject : t.requests.slicer.opensModel,
      })
    },
    onError: (error) => toast.error(errorMessage(error, t.requests.slicer.failed)),
  })
  return (
    <Button type="button" variant="outline" disabled={open.isPending} onClick={() => open.mutate()}>
      {open.isPending && <Spinner />}
      {t.requests.slicer.open(slicer.name)}
    </Button>
  )
}
