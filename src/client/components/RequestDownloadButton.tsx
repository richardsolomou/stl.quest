import { usePostHog } from '@posthog/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button, ButtonLink } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '../../core/error'
import { resolvedSlicer, type Slicer } from '../../core/slicers'
import type { PublicPrintRequest } from '../../core/types'
import { createSlicerLink } from '../../server/fns'
import { appPath } from '../../basePath'
import { requestDownloadHref } from '../boardDownload'
import { signalProductTourProgress } from '../productTour'
import { consumablesQuery, printersQuery, usagePrefillsQuery } from '../queries'
import { useI18n } from '../i18n'
import { useWorkspaceSlug } from '../workspace'

export function RequestDownloadButton({ request, isAdmin }: { request: PublicPrintRequest; isAdmin: boolean }) {
  const { t } = useI18n()
  const posthog = usePostHog()
  const slicer = useRequestSlicer(request, isAdmin)
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

/**
 * The slicer the request's printer sends its files to, or the material last printed on that printer when it names its
 * own; only admins set printers up, so only they see it.
 */
function useRequestSlicer(request: PublicPrintRequest, isAdmin: boolean) {
  const workspaceSlug = useWorkspaceSlug()
  const printer = useQuery({ ...printersQuery(workspaceSlug), enabled: isAdmin }).data?.profiles.find(
    ({ id }) => id === request.printer?.id,
  )
  const consumables = useQuery({ ...consumablesQuery(workspaceSlug), enabled: Boolean(printer) }).data?.consumables
  const loaded = useQuery({ ...usagePrefillsQuery(workspaceSlug), enabled: Boolean(printer) }).data?.materials[printer?.id ?? '']
  const material = consumables?.find((consumable) => consumable.id === loaded && !consumable.archived)
  return resolvedSlicer(printer, material && (material.kind === 'resin' || material.kind === 'filament') ? material : undefined)
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
      window.location.href = openUrl(new URL(appPath(path), window.location.origin).href)
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
