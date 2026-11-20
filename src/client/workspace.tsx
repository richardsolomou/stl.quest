import { createContext, useContext, type ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { appPath } from '../basePath'
import { sessionQuery } from './queries'

const WorkspaceSlugContext = createContext<string | undefined>(undefined)

export const WORKSPACE_CHANGED_KEY = 'stlquest-workspace-changed'

export function reloadAfterWorkspaceChange() {
  localStorage.setItem(WORKSPACE_CHANGED_KEY, String(Date.now()))
  window.location.assign(appPath('/'))
}

export function WorkspaceProvider({ slug, children }: { slug: string; children: ReactNode }) {
  return <WorkspaceSlugContext.Provider value={slug}>{children}</WorkspaceSlugContext.Provider>
}

export function useWorkspaceSlug() {
  const slug = useContext(WorkspaceSlugContext)
  if (!slug) throw new Error('workspace context is missing')
  return slug
}

/** What the current workspace prints, which narrows every print-type choice; resolved by the server from its setting and printers. */
export function useWorkspacePrintTypes() {
  return useSuspenseQuery(sessionQuery(useWorkspaceSlug())).data.printTypes
}

/** Whether the workspace records what each step uses; stock, maintenance, spend, and the step sheets show only while it does. */
export function useUsageTracking() {
  return useSuspenseQuery(sessionQuery(useWorkspaceSlug())).data.usageTracking
}
