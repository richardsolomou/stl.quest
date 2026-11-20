import type { Identity } from '../../core/types'
import type { SettingsSection } from '../settingsSections'
import { BoardPane } from './settings/BoardPane'
import { ConsumablesPane } from './settings/ConsumablesPane'
import { EmailPane } from './settings/EmailPane'
import { EquipmentPane } from './settings/EquipmentPane'
import { PricingPane } from './settings/PricingPane'
import { PrintersPane } from './settings/PrintersPane'
import { StoragePane } from './settings/StoragePane'
import { UsersPane } from './settings/UsersPane'

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
    case 'equipment':
      return <EquipmentPane />
    case 'consumables':
      return <ConsumablesPane />
    case 'pricing':
      return <PricingPane />
    case 'users':
      return <UsersPane me={me} />
    case 'email':
      return <EmailPane workspaceName={workspaceName} />
    case 'storage':
      return <StoragePane />
  }
}
