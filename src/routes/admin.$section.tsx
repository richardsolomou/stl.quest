import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { isSuperAdminSection, SuperAdminPanes } from '../client/components/SuperAdminPanes'
import { AppRail } from '../client/components/AppRail'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/admin/$section')({
  beforeLoad: ({ params }) => {
    if (!isSuperAdminSection(params.section))
      throw redirect({
        to: '/admin/$section',
        params: { section: 'users' },
      })
  },
  component: SuperAdminPage,
})

function SuperAdminPage() {
  const { section } = Route.useParams()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const [hydrated, setHydrated] = useState(false)
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const validSection = isSuperAdminSection(section) ? section : undefined
  const authorized = Boolean(identity?.superAdmin && validSection)
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  if (!authorized) return null
  return (
    <div className="flex h-dvh">
      <AppRail active="admin" isAdmin={identity!.role === 'admin'} isSuperAdmin navigationEnabled={hydrated} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-5 pt-7 pb-12">
          <SuperAdminPanes section={validSection!} />
        </div>
      </main>
    </div>
  )
}
