import type { Identity } from '../core/types'

export type BoardViewer = Pick<Identity, 'id' | 'name' | 'image'>

type ViewerState = { viewer: BoardViewer; connections: number }

export class BoardPresence {
  private workspaces = new Map<string, Map<string, ViewerState>>()
  private listeners = new Map<string, Set<(viewers: BoardViewer[]) => void>>()

  join(workspaceId: string, identity: Identity, listener?: (viewers: BoardViewer[]) => void) {
    const viewers = this.workspaces.get(workspaceId) ?? new Map<string, ViewerState>()
    const current = viewers.get(identity.id)
    viewers.set(identity.id, {
      viewer: { id: identity.id, name: identity.name, image: identity.image },
      connections: (current?.connections ?? 0) + 1,
    })
    this.workspaces.set(workspaceId, viewers)
    if (listener) {
      const listeners = this.listeners.get(workspaceId) ?? new Set()
      listeners.add(listener)
      this.listeners.set(workspaceId, listeners)
    }
    this.broadcast(workspaceId)

    let left = false
    return () => {
      if (left) return
      left = true
      if (listener) this.listeners.get(workspaceId)?.delete(listener)
      const active = this.workspaces.get(workspaceId)
      const state = active?.get(identity.id)
      if (state && state.connections > 1) state.connections--
      else active?.delete(identity.id)
      if (!active?.size) this.workspaces.delete(workspaceId)
      this.broadcast(workspaceId)
    }
  }

  private broadcast(workspaceId: string) {
    const viewers = [...(this.workspaces.get(workspaceId)?.values() ?? [])]
      .map(({ viewer }) => viewer)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    for (const listener of this.listeners.get(workspaceId) ?? []) listener(viewers)
  }
}

export const boardPresence = new BoardPresence()
