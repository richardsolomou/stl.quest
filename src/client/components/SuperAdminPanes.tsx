import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { SuperAdminDiagnosticsPane } from './settings/SuperAdminDiagnosticsPane'
import { SuperAdminUsersPane } from './settings/SuperAdminUsersPane'
import { IntegrationsPane } from './settings/IntegrationsPane'
import { TelemetryPane } from './settings/TelemetryPane'

export const superAdminSections = ['users', 'integrations', 'telemetry', 'diagnostics'] as const
export type SuperAdminSection = (typeof superAdminSections)[number]

const panes: { id: SuperAdminSection; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

export function isSuperAdminSection(value: string): value is SuperAdminSection {
  return superAdminSections.includes(value as SuperAdminSection)
}

export function SuperAdminPanes({ section }: { section: SuperAdminSection }) {
  return (
    <div className="grid items-start gap-6 sm:grid-cols-[210px_1fr]">
      <nav
        className="sticky top-6 flex flex-col gap-0.5 border-r-2 border-dashed border-blueprint/25 pr-3 max-sm:static max-sm:grid max-sm:grid-cols-4 max-sm:border-r-0 max-sm:border-b-2 max-sm:pb-2.5 max-sm:pr-0"
        aria-label="Super admin sections"
      >
        {panes.map((item) => (
          <Link
            key={item.id}
            to="/admin/$section"
            params={{ section: item.id }}
            className={cn(
              'w-full justify-start rounded-sm border-l-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-sm:min-w-0 max-sm:justify-center max-sm:border-l-0 max-sm:border-b-2 max-sm:px-1 max-sm:text-xs',
              section === item.id && 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {section === 'users' && <SuperAdminUsersPane />}
        {section === 'integrations' && <IntegrationsPane />}
        {section === 'telemetry' && <TelemetryPane />}
        {section === 'diagnostics' && <SuperAdminDiagnosticsPane />}
      </div>
    </div>
  )
}
