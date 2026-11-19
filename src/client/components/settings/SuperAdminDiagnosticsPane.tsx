import { DiagnosticsPane } from './DiagnosticsPane'
import { PageHeader, SettingsPage } from './SettingsLayout'
import { SystemDiagnosticsPane } from './SystemDiagnosticsPane'
import { useI18n } from '../../i18n'

export function SuperAdminDiagnosticsPane() {
  const { t } = useI18n()
  return (
    <SettingsPage>
      <PageHeader title={t.superAdmin.diagnostics.title} description={t.superAdmin.diagnostics.description} />
      <SystemDiagnosticsPane />
      <DiagnosticsPane />
    </SettingsPage>
  )
}
