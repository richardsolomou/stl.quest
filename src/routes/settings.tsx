import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SettingsPanes } from '../client/components/SettingsPanes'
import { sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  if (session.identity?.role !== 'operator') {
    void navigate({ to: '/' })
    return null
  }
  return (
    <div className="settings-layout">
      <header className="header">
        <h1 className="logo">Print<span className="accent">Hub</span></h1>
        <span className="who">v{__APP_VERSION__}</span>
        <span className="header-spacer" />
        <div className="header-actions">
          <Link to="/" className="btn">Back to board</Link>
        </div>
      </header>
      <main className="settings-page">
        <SettingsPanes me={session.identity} />
      </main>
    </div>
  )
}
