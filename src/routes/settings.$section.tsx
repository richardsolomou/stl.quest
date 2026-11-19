import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SettingsPanes, isSettingsSection } from '../client/components/SettingsPanes'
import { SettingsShell } from '../client/components/settings/SettingsShell'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useI18n } from '../client/i18n'

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
  const navigate = useNavigate()
  const { t } = useI18n()
  const identity = session.identity
  const workspaceSlug = identity?.workspaceSlug
  const validSection = isSettingsSection(section) ? section : undefined
  const authorized = Boolean(identity?.role === 'admin' && validSection)
  // A member who follows a workspace settings link still has their own account settings.
  useEffect(() => {
    if (!authorized) void navigate({ to: identity ? '/account' : '/' })
  }, [authorized, identity, navigate])
  useEffect(() => {
    if (!authorized || identity?.role !== 'admin' || !workspaceSlug) return
    void queryClient.prefetchQuery(requestsQuery(workspaceSlug))
    void queryClient.prefetchQuery(peopleQuery(workspaceSlug))
  }, [authorized, identity?.role, queryClient, workspaceSlug])
  if (!authorized) return null
  return (
    <SettingsShell current={{ kind: 'workspace', section: validSection! }}>
      <SettingsPanes
        me={identity!}
        section={validSection!}
        workspaceName={session.workspace?.name ?? t.settings.sections.workspaceFallback}
        workspaceCount={session.workspaces.length}
      />
    </SettingsShell>
  )
}
