/** Enough of a print to address the assets stored for it. */
export type RequestAssets = { id: string; updatedAt: number }

// The asset routes cache for a year against a URL keyed only by the request id, and a print's model can be
// replaced, so every link carries the timestamp that moves whenever the stored file does.
function versioned(path: string, request: RequestAssets, params: Record<string, string> = {}) {
  return `${path}?${new URLSearchParams({ ...params, v: String(request.updatedAt) }).toString()}`
}

/** Build the file-download URL for one or more requests. A single print downloads
 *  its model directly; several download a batch archive. */
export function requestDownloadHref(requests: RequestAssets[]): string {
  if (requests.length === 1) return versioned(`/api/files/${requests[0].id}`, requests[0])
  return `/api/files/batch?${new URLSearchParams(requests.map(({ id }) => ['id', id])).toString()}`
}

export function requestModelHref(request: RequestAssets, preview: boolean) {
  return versioned(`/api/files/${request.id}`, request, preview ? { inline: '1', preview: '1' } : { inline: '1' })
}

export function requestThumbnailHref(request: RequestAssets) {
  return versioned(`/api/thumbs/${request.id}`, request)
}

export function requestCoverHref(request: RequestAssets) {
  return versioned(`/api/source-images/${request.id}`, request)
}
