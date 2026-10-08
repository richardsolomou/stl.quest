import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { requestThumbnailHref, type RequestAssets } from '../boardDownload'

// The thumbnail route answers 503 while a storage read is briefly unavailable, so a failed load
// tries again before the card settles on the placeholder.
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000]

export function LazyThumb({ request, className }: { request: RequestAssets; className?: string }) {
  // A replaced model moves the URL, so its thumbnail starts again from a clean state.
  return <ThumbImage key={requestThumbnailHref(request)} request={request} className={className} />
}

function ThumbImage({ request, className }: { request: RequestAssets; className?: string }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(retryTimer.current), [])
  return (
    <div
      className={cn(
        'thumb relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background [background-image:var(--grid)] [background-size:12px_12px]',
        className,
      )}
    >
      {failed ? (
        <span className="font-mono text-[10px] text-muted-foreground">stl</span>
      ) : (
        <>
          {!loaded && <Spinner className="absolute text-muted-foreground" aria-label="Loading thumbnail" />}
          <img
            className={`absolute inset-0 size-full object-contain select-none ${loaded ? '' : 'invisible'}`}
            loading="lazy"
            decoding="async"
            src={requestThumbnailHref(request, attempt)}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => {
              const delay = RETRY_DELAYS_MS[attempt]
              if (delay === undefined) setFailed(true)
              else retryTimer.current = setTimeout(() => setAttempt(attempt + 1), delay)
            }}
          />
        </>
      )}
    </div>
  )
}
