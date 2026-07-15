import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppHeader } from '../client/components/AppHeader'
import { SettingsPanes, isSettingsSection } from '../client/components/SettingsPanes'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/settings/$section')({
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section)) throw redirect({ to: '/settings/$section', params: { section: 'account' } })
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const queryClient = useQueryClient()
  const [hydrated, setHydrated] = useState(false)
  const { section } = Route.useParams()
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const validSection = isSettingsSection(section) ? section : undefined
  const authorized = Boolean(identity && validSection)
  const allowedSection = identity?.role === 'admin' || validSection === 'account'
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  useEffect(() => {
    if (authorized && !allowedSection) void navigate({ to: '/settings/$section', params: { section: 'account' }, replace: true })
  }, [allowedSection, authorized, navigate])
  useEffect(() => {
    if (!authorized || identity?.role !== 'admin') return
    void queryClient.prefetchQuery(requestsQuery())
    void queryClient.prefetchQuery(peopleQuery())
  }, [authorized, identity?.role, queryClient])
  if (!authorized || !allowedSection) return null
  return (
    <div className="min-h-dvh">
      <AppHeader
        active="settings"
        isAdmin={identity!.role === 'admin'}
        showPlanner={session.printers.length > 0}
        navigationEnabled={hydrated}
      />
      <main className="mx-auto w-full max-w-[980px] px-5 pt-7 pb-12">
        <SettingsPanes me={identity!} section={validSection!} />
      </main>
    </div>
  )
}
