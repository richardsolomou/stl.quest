import { getRequest } from '@tanstack/react-start/server'
import { app } from './app'
import { normalizeAuthHeaders } from './authCookies'
import { mutationRpc } from './rpc'

const workspaceContext = async (workspaceSlug: string) => {
  const instance = await app()
  return instance.workspace(normalizeAuthHeaders(getRequest().headers), workspaceSlug)
}

type WorkspaceContext = Awaited<ReturnType<typeof workspaceContext>>

export function workspaceMutation<T>(workspaceSlug: string, action: (context: WorkspaceContext) => Promise<T> | T) {
  return mutationRpc(async () => action(await workspaceContext(workspaceSlug)))
}
