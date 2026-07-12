import { Link, createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { SettingsPanes } from '../components/SettingsPanes'
import { useEscape } from '../lib/useEscape'

const rootRoute = getRouteApi('__root__')

export const Route = createFileRoute('/settings')({ component: SettingsPage })

function SettingsPage() {
  const session = rootRoute.useLoaderData()
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
