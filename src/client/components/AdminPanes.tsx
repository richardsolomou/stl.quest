import { IntegrationsPane } from './settings/IntegrationsPane'
import { SystemDiagnosticsPane } from './settings/SystemDiagnosticsPane'
import { TelemetryPane } from './settings/TelemetryPane'

export const adminSections = ['integrations', 'telemetry', 'diagnostics'] as const
export type AdminSection = (typeof adminSections)[number]

export function isAdminSection(value: string): value is AdminSection {
  return adminSections.includes(value as AdminSection)
}

export function AdminPanes({ section }: { section: AdminSection }) {
  return (
    <div className="min-w-0">
      {section === 'integrations' && <IntegrationsPane />}
      {section === 'telemetry' && <TelemetryPane />}
      {section === 'diagnostics' && <SystemDiagnosticsPane />}
    </div>
  )
}
