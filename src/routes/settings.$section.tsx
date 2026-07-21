import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppRail } from '../client/components/AppRail'
import { SettingsPanes, isSettingsSection } from '../client/components/SettingsPanes'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/settings/$section')({
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section))
      throw redirect({
        to: '/settings/$section',
        params: { section: 'board' },
      })
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { section } = Route.useParams()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const queryClient = useQueryClient()
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const workspaceSlug = identity?.workspaceSlug
  const validSection = isSettingsSection(section) ? section : undefined
  const authorized = Boolean(identity?.role === 'admin' && validSection)
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  useEffect(() => {
    if (!authorized || identity?.role !== 'admin' || !workspaceSlug) return
    void queryClient.prefetchQuery(requestsQuery(workspaceSlug))
    void queryClient.prefetchQuery(peopleQuery(workspaceSlug))
  }, [authorized, identity?.role, queryClient, workspaceSlug])
  if (!authorized) return null
  return (
    <div className="flex h-dvh">
      <AppRail active="settings" isAdmin={identity!.role === 'admin'} isSuperAdmin={identity!.superAdmin} navigationEnabled={hydrated} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 pt-7 pb-12">
          <SettingsPanes
            me={identity!}
            section={validSection!}
            workspaceName={session.workspace?.name ?? 'Workspace'}
            workspaceCount={session.workspaces.length}
          />
        </div>
      </main>
    </div>
  )
}
