import { createContext, useContext, type ReactNode } from 'react'

const WorkspaceSlugContext = createContext<string | undefined>(undefined)

export function WorkspaceProvider({ slug, children }: { slug: string; children: ReactNode }) {
  return <WorkspaceSlugContext.Provider value={slug}>{children}</WorkspaceSlugContext.Provider>
}

export function useWorkspaceSlug() {
  const slug = useContext(WorkspaceSlugContext)
  if (!slug) throw new Error('workspace context is missing')
  return slug
}
