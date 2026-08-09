import type { ClientInfo, Subscription } from 'centrifuge'

export type BoardViewer = { id: string; name: string; image?: string }

export function boardViewers(connections: Iterable<ClientInfo>) {
  const unique = new Map<string, BoardViewer>()
  for (const info of connections) {
    const viewer = info.chanInfo as BoardViewer | undefined
    if (viewer?.id && viewer.name) unique.set(viewer.id, viewer)
  }
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

export function watchBoardPresence(subscription: Subscription, update: (viewers: BoardViewer[]) => void) {
  const connections = new Map<string, ClientInfo>()
  let active = true
  let revision = 0
  const render = () => update(boardViewers(connections.values()))
  const refresh = async (): Promise<void> => {
    const requestedAt = revision
    try {
      const { clients } = await subscription.presence()
      if (!active) return
      if (revision !== requestedAt) return refresh()
      connections.clear()
      for (const [id, info] of Object.entries(clients)) connections.set(id, info)
      render()
    } catch {
      if (!active) return
      connections.clear()
      render()
    }
  }
  subscription.on('subscribed', () => void refresh())
  subscription.on('join', ({ info }) => {
    revision++
    connections.set(info.client, info)
    render()
  })
  subscription.on('leave', ({ info }) => {
    revision++
    connections.delete(info.client)
    render()
  })
  return () => {
    active = false
    connections.clear()
    render()
  }
}
