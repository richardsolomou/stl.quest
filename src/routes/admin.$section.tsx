import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { SuperAdminPanes } from '../client/components/SuperAdminPanes'
import { isSuperAdminSection } from '../client/settingsSections'
import { SettingsShell } from '../client/components/settings/SettingsShell'
import { sessionQuery } from '../client/queries'

export const Route = createFileRoute('/admin/$section')({
  beforeLoad: ({ params }) => {
    if (!isSuperAdminSection(params.section))
      throw redirect({
        to: '/admin/$section',
        params: { section: 'overview' },
      })
  },
  component: SuperAdminPage,
})

function SuperAdminPage() {
  const { section } = Route.useParams()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const navigate = useNavigate()
  const identity = session.identity
  const validSection = isSuperAdminSection(section) ? section : undefined
  const authorized = Boolean(identity?.superAdmin && validSection)
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  return (
    <SettingsShell current={{ kind: 'admin', section: validSection! }}>
      <SuperAdminPanes section={validSection!} hosted={session.hosted} />
    </SettingsShell>
  )
}
