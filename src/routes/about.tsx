import { createFileRoute } from '@tanstack/react-router'
import { AboutPane } from '../client/components/settings/AboutPane'
import { SettingsShell } from '../client/components/settings/SettingsShell'

export const Route = createFileRoute('/about')({ component: AboutPage })

function AboutPage() {
  return (
    <SettingsShell current={{ kind: 'about' }}>
      <AboutPane />
    </SettingsShell>
  )
}
