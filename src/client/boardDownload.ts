/** Build the file-download URL for one or more requests. A single id downloads
 *  the STL directly; several ids download a batch archive. */
export function requestDownloadHref(ids: string[]): string {
  if (ids.length === 1) return `/api/files/${ids[0]}`
  return `/api/files/batch?${new URLSearchParams(ids.map((id) => ['id', id])).toString()}`
}
