import { usePostHog } from '@posthog/react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PublicPrintRequest } from '../../core/types'
import { requestDownloadHref } from '../boardDownload'
import { signalProductTourProgress } from '../productTour'
import { useI18n } from '../i18n'

export function RequestDownloadButton({ request }: { request: PublicPrintRequest }) {
  const { t } = useI18n()
  const posthog = usePostHog()
  return (
    <a
      className={cn(buttonVariants({ variant: 'outline' }))}
      href={requestDownloadHref([request])}
      download
      onClick={() => {
        posthog.capture('stl_downloaded', { print_type: request.printType })
        signalProductTourProgress('download')
      }}
    >
      {t.requests.downloadModel}
    </a>
  )
}
