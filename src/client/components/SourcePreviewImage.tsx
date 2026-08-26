import { useState, type ReactNode } from 'react'
import { requestCoverHref, type RequestAssets } from '../boardDownload'

export function SourcePreviewImage({ request, className, fallback }: { request: RequestAssets; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)

  if (failed) return fallback

  return (
    <img src={requestCoverHref(request)} alt="" className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  )
}
