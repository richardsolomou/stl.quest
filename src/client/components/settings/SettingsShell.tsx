import { useState, type ComponentProps, type ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useI18n } from '../../i18n'
import { sessionQuery } from '../../queries'
import { AppShell } from '../AppShell'
import { settingsSections, type SettingsSection } from '../SettingsPanes'
import { superAdminSections, type SuperAdminSection } from '../SuperAdminPanes'

export type SettingsLocation =
  | { kind: 'workspace'; section: SettingsSection }
  | { kind: 'admin'; section: SuperAdminSection }
  | { kind: 'account' }
  | { kind: 'plan' }
  | { kind: 'about' }

type NavItem = { location: SettingsLocation; label: string }
type NavGroup = { id: string; label: string; detail?: string; items: NavItem[] }

const sameLocation = (a: SettingsLocation, b: SettingsLocation) =>
  a.kind === b.kind && ('section' in a ? a.section === (b as typeof a).section : true)

function LocationLink({ location, ...props }: { location: SettingsLocation } & Omit<ComponentProps<'a'>, 'href'>) {
  switch (location.kind) {
    case 'workspace':
      return <Link to="/settings/$section" params={{ section: location.section }} {...props} />
    case 'admin':
      return <Link to="/admin/$section" params={{ section: location.section }} {...props} />
    case 'account':
      return <Link to="/account" {...props} />
    case 'plan':
      return <Link to="/plan" {...props} />
    case 'about':
      return <Link to="/about" {...props} />
  }
}

function useNavGroups(): NavGroup[] {
  const { t } = useI18n()
  const { data: session } = useSuspenseQuery(sessionQuery())
  const identity = session.identity
  const nav = t.shell.settingsNav
  const groups: NavGroup[] = []
  if (identity?.role === 'admin') {
    groups.push({
      id: 'workspace',
      label: nav.workspace,
      detail: session.workspace?.name,
      items: settingsSections.map((section) => ({ location: { kind: 'workspace', section }, label: t.settings.sections[section] })),
    })
  }
  groups.push({
    id: 'you',
    label: nav.you,
    items: [
      { location: { kind: 'account' }, label: nav.account },
      ...(session.billing?.available ? [{ location: { kind: 'plan' } as const, label: nav.plan }] : []),
    ],
  })
  if (identity?.superAdmin) {
    groups.push({
      id: 'server',
      label: nav.server,
      items: superAdminSections.map((section) => ({ location: { kind: 'admin', section }, label: t.superAdmin.nav[section] })),
    })
  }
  groups.push({ id: 'product', label: nav.product, items: [{ location: { kind: 'about' }, label: nav.about }] })
  return groups
}

function NavList({ groups, current, onNavigate }: { groups: NavGroup[]; current: SettingsLocation; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1.5">
            <p className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{group.label}</p>
            {group.detail && <p className="ph-no-capture mt-1 truncate text-xs text-foreground">{group.detail}</p>}
          </div>
          {group.items.map((item) => {
            const active = sameLocation(item.location, current)
            return (
              <LocationLink
                key={item.label}
                location={item.location}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-sm text-muted-foreground no-underline transition-colors hover:bg-muted hover:text-foreground',
                  active && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary',
                )}
              >
                {item.label}
              </LocationLink>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** One place for every setting a person can reach: their workspace, their account, the server, and the product. */
export function SettingsShell({ current, children }: { current: SettingsLocation; children: ReactNode }) {
  return (
    <AppShell active="settings">
      <SettingsFrame current={current}>{children}</SettingsFrame>
    </AppShell>
  )
}

function SettingsFrame({ current, children }: { current: SettingsLocation; children: ReactNode }) {
  const { t } = useI18n()
  const groups = useNavGroups()
  const [open, setOpen] = useState(false)
  const currentGroup = groups.find((group) => group.items.some((item) => sameLocation(item.location, current)))
  const currentItem = currentGroup?.items.find((item) => sameLocation(item.location, current))
  return (
    <div className="grid items-start gap-x-8 gap-y-5 md:grid-cols-[13rem_minmax(0,1fr)]">
      <nav className="sticky top-0 border-r-2 border-dashed border-blueprint/25 pr-3 max-md:hidden" aria-label={t.shell.settingsNav.label}>
        <NavList groups={groups} current={current} />
      </nav>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-left text-sm md:hidden"
              aria-label={t.shell.settingsNav.choose}
            />
          }
        >
          <span className="font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {currentGroup?.label}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{currentItem?.label}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="max-h-[var(--available-height)] w-(--anchor-width) overflow-y-auto p-2">
          <nav aria-label={t.shell.settingsNav.label}>
            <NavList groups={groups} current={current} onNavigate={() => setOpen(false)} />
          </nav>
        </PopoverContent>
      </Popover>
      <div className="min-w-0 md:max-w-4xl">{children}</div>
    </div>
  )
}
