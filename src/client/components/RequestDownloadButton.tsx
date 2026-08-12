import { usePostHog } from '@posthog/react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PrintType } from '../../core/types'
import { requestDownloadHref } from '../boardDownload'
import { signalProductTourProgress } from '../productTour'

export function RequestDownloadButton({ requestId, printType }: { requestId: string; printType?: PrintType }) {
  const posthog = usePostHog()
  return (
    <a
      className={cn(buttonVariants({ variant: 'outline' }))}
      href={requestDownloadHref([requestId])}
      download
      onClick={() => {
        posthog.capture('stl_downloaded', { print_type: printType })
        signalProductTourProgress('download')
      }}
    >
      Download STL
    </a>
  )
}
