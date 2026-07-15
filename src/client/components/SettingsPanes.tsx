import { Link } from '@tanstack/react-router'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Identity } from '../../core/types'
import { AccountPane } from './settings/AccountPane'
import { AboutPane } from './settings/AboutPane'
import { BoardPane } from './settings/BoardPane'
import { DiagnosticsPane } from './settings/DiagnosticsPane'
import { IntegrationsPane } from './settings/IntegrationsPane'
import { PrintersPane } from './settings/PrintersPane'
import { StoragePane } from './settings/StoragePane'
import { TelemetryPane } from './settings/TelemetryPane'
import { UsersPane } from './settings/UsersPane'

export const settingsSections = [
  'account',
  'board',
  'printers',
  'users',
  'storage',
  'integrations',
  'telemetry',
  'diagnostics',
  'about',
] as const
export type SettingsSection = (typeof settingsSections)[number]

const panes: { id: SettingsSection; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'board', label: 'Board' },
  { id: 'printers', label: 'Printers' },
  { id: 'users', label: 'Users' },
  { id: 'storage', label: 'Storage' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'telemetry', label: 'Telemetry' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'about', label: 'About' },
]

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSections.includes(value as SettingsSection)
}

export function SettingsPanes({ me, section }: { me: Identity; section: SettingsSection }) {
  const availablePanes = me.role === 'admin' ? panes : panes.filter((pane) => pane.id === 'account')
  return (
    <div className="grid items-start gap-6 sm:grid-cols-[170px_1fr]">
      <nav
        className="sticky top-6 flex flex-col gap-0.5 border-r pr-3 max-sm:static max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b max-sm:pb-2.5 max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
        aria-label="Settings sections"
      >
        {availablePanes.map((item) => (
          <Link
            key={item.id}
            to="/settings/$section"
            params={{ section: item.id }}
            className={cn(
              buttonVariants({ variant: section === item.id ? 'secondary' : 'ghost' }),
              'h-auto w-full justify-start px-2.5 py-2 text-muted-foreground max-sm:w-auto max-sm:shrink-0',
              section === item.id && 'text-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        {section === 'account' && <AccountPane me={me} />}
        {me.role === 'admin' && section === 'board' && <BoardPane />}
        {me.role === 'admin' && section === 'printers' && <PrintersPane />}
        {me.role === 'admin' && section === 'users' && <UsersPane me={me} />}
        {me.role === 'admin' && section === 'storage' && <StoragePane />}
        {me.role === 'admin' && section === 'integrations' && <IntegrationsPane />}
        {me.role === 'admin' && section === 'telemetry' && <TelemetryPane />}
        {me.role === 'admin' && section === 'diagnostics' && <DiagnosticsPane />}
        {me.role === 'admin' && section === 'about' && <AboutPane />}
      </div>
    </div>
  )
}
