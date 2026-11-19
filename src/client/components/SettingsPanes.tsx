import type { Identity } from '../../core/types'
import { BoardPane } from './settings/BoardPane'
import { ConsumablesPane } from './settings/ConsumablesPane'
import { EmailPane } from './settings/EmailPane'
import { PrintersPane } from './settings/PrintersPane'
import { StoragePane } from './settings/StoragePane'
import { UsersPane } from './settings/UsersPane'

export const settingsSections = ['board', 'printers', 'consumables', 'users', 'email', 'storage'] as const
export type SettingsSection = (typeof settingsSections)[number]

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection)
}

export function SettingsPanes({
  me,
  section,
  workspaceName,
  workspaceCount,
}: {
  me: Identity
  section: SettingsSection
  workspaceName: string
  workspaceCount: number
}) {
  switch (section) {
    case 'board':
      return <BoardPane me={me} workspaceName={workspaceName} workspaceCount={workspaceCount} />
    case 'printers':
      return <PrintersPane />
    case 'consumables':
      return <ConsumablesPane />
    case 'users':
      return <UsersPane me={me} />
    case 'email':
      return <EmailPane workspaceName={workspaceName} />
    case 'storage':
      return <StoragePane />
  }
}
