import { DiagnosticsPane } from './DiagnosticsPane'
import { SettingsHeader, SettingsPage } from './SettingsLayout'
import { SystemDiagnosticsPane } from './SystemDiagnosticsPane'

export function AdminDiagnosticsPane() {
  return (
    <SettingsPage>
      <SettingsHeader
        title="Diagnostics"
        description="Inspect deployment, authentication, database, storage, upload, and asset-processing health."
      />
      <SystemDiagnosticsPane embedded />
      <DiagnosticsPane embedded />
    </SettingsPage>
  )
}
