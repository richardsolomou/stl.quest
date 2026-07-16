import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AdminPanes, isAdminSection } from '../client/components/AdminPanes'
import { AppShell } from '../client/components/AppShell'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/admin/$section')({
  beforeLoad: ({ params }) => {
    if (!isAdminSection(params.section))
      throw redirect({
        to: '/admin/$section',
        params: { section: 'integrations' },
      })
  },
  component: AdminPage,
})

function AdminPage() {
  const { section } = Route.useParams()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const validSection = isAdminSection(section) ? section : undefined
  const authorized = Boolean(identity?.deploymentAdmin && validSection)
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  const title =
    validSection === 'integrations' ? 'Authentication & email' : validSection === 'diagnostics' ? 'System diagnostics' : 'Telemetry'
  return (
    <AppShell
      active={`admin:${validSection!}`}
      identity={identity!}
      showPlanner={session.printers.length > 0}
      navigationEnabled={hydrated}
      title={title}
    >
      <main className="mx-auto w-full max-w-[980px] px-5 pt-7 pb-12">
        <AdminPanes section={validSection!} />
      </main>
    </AppShell>
  )
}
