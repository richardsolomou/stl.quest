import type { Identity } from '../../core/types'
import { AccountPane } from './settings/AccountPane'
import { AboutPane } from './settings/AboutPane'
import { BoardPane } from './settings/BoardPane'
import { DiagnosticsPane } from './settings/DiagnosticsPane'
import { PrintersPane } from './settings/PrintersPane'
import { StoragePane } from './settings/StoragePane'
import { UsersPane } from './settings/UsersPane'

export const settingsSections = ['account', 'board', 'printers', 'users', 'storage', 'diagnostics', 'about'] as const
export type SettingsSection = (typeof settingsSections)[number]

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection)
}

export function SettingsPanes({ me, section }: { me: Identity; section: SettingsSection }) {
  return (
    <div className="min-w-0">
      {section === 'account' && <AccountPane me={me} />}
      {me.role === 'admin' && section === 'board' && <BoardPane />}
      {me.role === 'admin' && section === 'printers' && <PrintersPane />}
      {me.role === 'admin' && section === 'users' && <UsersPane me={me} />}
      {me.role === 'admin' && section === 'storage' && <StoragePane />}
      {me.role === 'admin' && section === 'diagnostics' && <DiagnosticsPane />}
      {me.role === 'admin' && section === 'about' && <AboutPane />}
    </div>
  )
}
