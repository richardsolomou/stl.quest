import { SuperAdminDiagnosticsPane } from './settings/SuperAdminDiagnosticsPane'
import { SuperAdminOverviewPane } from './settings/SuperAdminOverviewPane'
import { SuperAdminUsersPane } from './settings/SuperAdminUsersPane'
import { SuperAdminWorkspacesPane } from './settings/SuperAdminWorkspacesPane'
import { IntegrationsPane } from './settings/IntegrationsPane'
import { TelemetryPane } from './settings/TelemetryPane'
import { ReleaseUpdateNotice } from './ReleaseUpdateNotice'
import type { SuperAdminSection } from '../settingsSections'

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
