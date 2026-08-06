import type { ClientInfo } from 'centrifuge'

export type BoardViewer = { id: string; name: string; image?: string }

export function boardViewers(connections: Iterable<ClientInfo>) {
  const unique = new Map<string, BoardViewer>()
  for (const info of connections) {
    const viewer = info.chanInfo as BoardViewer | undefined
    if (viewer?.id && viewer.name) unique.set(viewer.id, viewer)
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}
