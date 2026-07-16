import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AdminDiagnosticsPane } from './settings/AdminDiagnosticsPane'
import { IntegrationsPane } from './settings/IntegrationsPane'
import { TelemetryPane } from './settings/TelemetryPane'

export const adminSections = ['integrations', 'telemetry', 'diagnostics'] as const
export type AdminSection = (typeof adminSections)[number]

const panes: { id: AdminSection; label: string }[] = [
  { id: 'integrations', label: 'Integrations' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'diagnostics', label: 'Diagnostics' },
]

export function isAdminSection(value: string): value is AdminSection {
  return adminSections.includes(value as AdminSection)
}

export function AdminPanes({ section }: { section: AdminSection }) {
  return (
    <div className="grid items-start gap-6 sm:grid-cols-[210px_1fr]">
      <nav
        className="sticky top-6 flex flex-col gap-0.5 border-r pr-3 max-sm:static max-sm:grid max-sm:grid-cols-3 max-sm:border-r-0 max-sm:border-b max-sm:pb-2.5 max-sm:pr-0"
        aria-label="Deployment administration sections"
      >
        {panes.map((item) => (
          <Link
            key={item.id}
            to="/admin/$section"
            params={{ section: item.id }}
            className={cn(
              buttonVariants({ variant: section === item.id ? 'secondary' : 'ghost' }),
              'h-auto w-full justify-start px-2.5 py-2 text-muted-foreground max-sm:min-w-0 max-sm:justify-center max-sm:px-1 max-sm:text-xs',
              section === item.id && 'text-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {section === 'integrations' && <IntegrationsPane />}
        {section === 'telemetry' && <TelemetryPane />}
        {section === 'diagnostics' && <AdminDiagnosticsPane />}
      </div>
    </div>
  )
}
