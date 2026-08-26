import { useState, type ReactNode } from 'react'

export function SourcePreviewImage({ requestId, className, fallback }: { requestId: string; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)

  if (failed) return fallback

  return (
    <img
      src={`/api/source-images/${requestId}`}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
