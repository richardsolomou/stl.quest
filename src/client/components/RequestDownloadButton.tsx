import { usePostHog } from '@posthog/react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PrintType } from '../../core/types'
import { signalProductTourProgress } from '../productTour'

export function RequestDownloadButton({ requestId, printType }: { requestId: string; printType?: PrintType }) {
  const posthog = usePostHog()
  return (
    <a
      className={cn(buttonVariants({ variant: 'outline' }))}
      href={`/api/files/${requestId}`}
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
