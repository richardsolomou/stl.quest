import { useState } from 'react'

// Plain URL + native lazy loading; the response is immutable-cached. Only
// mounted once the request has a thumbnail (hasThumbnail gates it).
export function LazyThumb({ requestId }: { requestId: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="thumb">
      {failed
        ? <span className="placeholder">stl</span>
        : <img loading="lazy" decoding="async" src={`/api/thumbs/${requestId}`} alt="" onError={() => setFailed(true)} />}
    </div>
  )
}
