import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import type { Identity } from '../../core/types'
import { BoardPane } from './settings/BoardPane'
import { PrintersPane } from './settings/PrintersPane'
import { StoragePane } from './settings/StoragePane'
import { UsersPane } from './settings/UsersPane'

export const settingsSections = ['board', 'printers', 'users', 'storage'] as const
export type SettingsSection = (typeof settingsSections)[number]

const panes: { id: SettingsSection; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'printers', label: 'Printers' },
  { id: 'users', label: 'Members' },
  { id: 'storage', label: 'Storage' },
]

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
  return (
    <div className="grid items-start gap-6 sm:grid-cols-[170px_1fr]">
      <nav
        className="sticky top-6 flex flex-col gap-0.5 border-r-2 border-dashed border-blueprint/25 pr-3 max-sm:static max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b-2 max-sm:pb-2.5 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
        aria-label="Workspace settings sections"
      >
        <p className="truncate px-3 pb-1 text-xs font-medium text-muted-foreground max-sm:hidden">{workspaceName}</p>
        {panes.map((item) => (
          <Link
            key={item.id}
            to="/settings/$section"
            params={{ section: item.id }}
            className={cn(
              'w-full justify-start rounded-sm border-l-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground max-sm:w-auto max-sm:shrink-0 max-sm:border-l-0 max-sm:border-b-2',
              section === item.id && 'border-primary bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {section === 'board' && <BoardPane me={me} workspaceName={workspaceName} workspaceCount={workspaceCount} />}
        {section === 'printers' && <PrintersPane />}
        {section === 'users' && <UsersPane me={me} />}
        {section === 'storage' && <StoragePane />}
      </div>
    </div>
  )
}
