import { Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublicPrintRequest } from '../../core/types'
import { LazyThumb } from './LazyThumb'
import { ModelFormatLabel } from './ModelFormatLabel'
import { SourcePreviewImage } from './SourcePreviewImage'

const thumbPlaceholder =
  'thumb absolute inset-0 overflow-hidden rounded-sm border border-ticket-foreground/15 bg-background [background-image:var(--grid)] [background-size:12px_12px]'

function LinkedThumbFallback() {
  return (
    <div className={cn(thumbPlaceholder, 'grid place-items-center')}>
      <Link2 className="size-6 text-primary" aria-label="Linked print" />
    </div>
  )
}

/** Fills its nearest positioned ancestor, which sets the size. */
export function RequestThumb({ request }: { request: PublicPrintRequest }) {
  if (request.hasThumbnail)
    return <LazyThumb request={request} className="absolute inset-0 size-auto rounded-sm border-ticket-foreground/15" />
  if (request.hasSourceImage)
    return (
      <SourcePreviewImage
        key={request.id}
        request={request}
        className="thumb absolute inset-0 rounded-sm border border-ticket-foreground/15 object-cover"
        fallback={<LinkedThumbFallback />}
      />
    )
  if (request.hasFile)
    return (
      <div className={cn(thumbPlaceholder, 'grid place-items-center')}>
        <ModelFormatLabel format={request.modelFormat} />
      </div>
    )
  return <LinkedThumbFallback />
}
