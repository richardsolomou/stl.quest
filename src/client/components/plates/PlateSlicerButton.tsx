import { useMutation } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '../../../core/error'
import { createPlateSlicerLink } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { slicerFileUrl, usePrinterSlicer } from '../../printerSlicer'
import { useWorkspaceSlug } from '../../workspace'
import { AppLogo } from '../AppLogo'

/**
 * Opens the plate in its printer's slicer as one file holding every copy, or downloads that file for a slicer that
 * cannot fetch it itself; the server builds it, so the link is signed and short-lived like a print's.
 */
export function PlateSlicerButton({ plate, size }: { plate: { id: string; printerId?: string }; size?: 'xs' | 'sm' }) {
  const { t } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const slicer = usePrinterSlicer(plate.printerId, true)
  const callCreateLink = useServerFn(createPlateSlicerLink)
  const open = useMutation({
    mutationFn: () => callCreateLink({ data: { workspaceSlug, plateId: plate.id, slicer: slicer?.id } }),
    onSuccess: ({ path, skipped }) => {
      const url = slicerFileUrl(path)
      const left = skipped ? t.plates.slicer.skipped(skipped) : undefined
      if (slicer?.openUrl) {
        window.location.href = slicer.openUrl(url)
        toast(t.requests.slicer.opening(slicer.name), { description: [t.plates.slicer.opensPlate, left].filter(Boolean).join(' ') })
        return
      }
      const download = document.createElement('a')
      download.href = url
      download.download = ''
      download.click()
      if (left) toast(left)
    },
    onError: (error) => toast.error(errorMessage(error, t.requests.slicer.failed)),
  })
  return (
    <Button type="button" size={size} variant="outline" disabled={open.isPending} onClick={() => open.mutate()}>
      {open.isPending ? <Spinner /> : slicer && <AppLogo app={slicer.id} className={size === 'xs' ? 'size-3.5' : undefined} />}
      {slicer?.openUrl ? t.requests.slicer.open(slicer.name) : slicer ? t.requests.slicer.download(slicer.name) : t.plates.slicer.download}
    </Button>
  )
}
