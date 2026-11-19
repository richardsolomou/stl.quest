import { SuperAdminDiagnosticsPane } from './settings/SuperAdminDiagnosticsPane'
import { SuperAdminOverviewPane } from './settings/SuperAdminOverviewPane'
import { SuperAdminUsersPane } from './settings/SuperAdminUsersPane'
import { SuperAdminWorkspacesPane } from './settings/SuperAdminWorkspacesPane'
import { IntegrationsPane } from './settings/IntegrationsPane'
import { TelemetryPane } from './settings/TelemetryPane'
import { ReleaseUpdateNotice } from './ReleaseUpdateNotice'

export const superAdminSections = ['overview', 'users', 'workspaces', 'integrations', 'telemetry', 'diagnostics'] as const
export type SuperAdminSection = (typeof superAdminSections)[number]

export function isSuperAdminSection(value: string): value is SuperAdminSection {
  return superAdminSections.includes(value as SuperAdminSection)
}

export function SuperAdminPanes({ section, hosted }: { section: SuperAdminSection; hosted: boolean }) {
  return (
    <>
      <ReleaseUpdateNotice hosted={hosted} />
      {section === 'overview' && <SuperAdminOverviewPane hosted={hosted} />}
      {section === 'users' && <SuperAdminUsersPane hosted={hosted} />}
      {section === 'workspaces' && <SuperAdminWorkspacesPane />}
      {section === 'integrations' && <IntegrationsPane />}
      {section === 'telemetry' && <TelemetryPane />}
      {section === 'diagnostics' && <SuperAdminDiagnosticsPane />}
    </>
  )
}
