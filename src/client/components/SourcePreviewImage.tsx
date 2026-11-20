import { useState, type ReactNode } from 'react'
import { requestCoverHref, type RequestAssets } from '../boardDownload'

/**
 * Shows `fallback` once the cover fails to load, until a change to the print gives the cover a new URL to try.
 * `overlay` sits over a cover only while it can be shown.
 */
export function SourcePreviewImage({
  request,
  className,
  fallback,
  overlay,
}: {
  request: RequestAssets
  className: string
  fallback: ReactNode
  overlay?: ReactNode
}) {
  const src = requestCoverHref(request)
  const [failedSrc, setFailedSrc] = useState<string>()

  if (failedSrc === src) return fallback

  return (
    <>
      <img src={src} alt="" className={className} loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      {overlay}
    </>
  )
}
