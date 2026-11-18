import { usePostHog } from '@posthog/react'
import { ButtonLink } from '@/components/ui/button'
import type { PublicPrintRequest } from '../../core/types'
import { requestDownloadHref } from '../boardDownload'
import { signalProductTourProgress } from '../productTour'
import { useI18n } from '../i18n'

export function RequestDownloadButton({ request }: { request: PublicPrintRequest }) {
  const { t } = useI18n()
  const posthog = usePostHog()
  return (
    <ButtonLink
      variant="outline"
      href={requestDownloadHref([request])}
      download
      onClick={() => {
        posthog.capture('stl_downloaded', { print_type: request.printType })
        signalProductTourProgress('download')
      }}
    >
      {t.requests.downloadModel}
    </ButtonLink>
  )
}
