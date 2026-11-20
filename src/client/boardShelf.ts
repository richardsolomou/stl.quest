/** The ready shelf as people collect from it: each requester's prints together, the first in shelf order leading. */
export function shelfByRequester<Entry extends { request: { requesterId: string } }>(entries: Entry[]) {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) groups.set(entry.request.requesterId, [...(groups.get(entry.request.requesterId) ?? []), entry])
  return [...groups].map(([requesterId, grouped]) => ({ requesterId, entries: grouped }))
}
