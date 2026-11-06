import { DiagnosticsPane } from './DiagnosticsPane'
import { SettingsHeader, SettingsPage } from './SettingsLayout'
import { SystemDiagnosticsPane } from './SystemDiagnosticsPane'
import { useI18n } from '../../i18n'

export function SuperAdminDiagnosticsPane() {
  const { t } = useI18n()
  return (
    <SettingsPage>
      <SettingsHeader title={t.superAdmin.diagnostics.title} description={t.superAdmin.diagnostics.description} />
      <SystemDiagnosticsPane embedded />
      <DiagnosticsPane embedded />
    </SettingsPage>
  )
}
