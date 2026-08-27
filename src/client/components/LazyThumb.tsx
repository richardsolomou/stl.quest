import { useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { requestThumbnailHref, type RequestAssets } from '../boardDownload'

export function LazyThumb({ request, className }: { request: RequestAssets; className?: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
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
            src={requestThumbnailHref(request)}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      )}
    </div>
  )
}
