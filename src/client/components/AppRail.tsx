import { type ComponentProps, type ReactNode, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Archive, Calculator, HardDrive, LayoutDashboard, Settings } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Identity } from '../../core/types'
import { AccountMenu } from './AccountMenu'
import { RailBrand } from './Brand'
import { useI18n } from '../i18n'
import { sessionQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { formatBytes } from '../../core/format'
import { nextStoragePlan, storageUsageLevel } from '../../core/plans'
import { useReleaseUpdate } from './ReleaseUpdateNotice'

export type AppView = 'board' | 'archive' | 'calculator' | 'settings'

type Destination = {
  view: AppView
  label: string
  icon: ReactNode
  to: '/' | '/archive' | '/calculator' | '/settings/$section' | '/account'
}

// Settings is one hub for everyone: admins land on their workspace, everyone else on their own account.
function useDestinations(identity: Identity): Destination[] {
  const { t } = useI18n()
  const isAdmin = identity.role === 'admin'
  return [
    { view: 'board', label: t.shell.rail.board, icon: <LayoutDashboard />, to: '/' },
    { view: 'archive', label: t.shell.rail.archive, icon: <Archive />, to: '/archive' },
    ...(isAdmin ? [{ view: 'calculator', label: t.shell.rail.calculator, icon: <Calculator />, to: '/calculator' } as const] : []),
    { view: 'settings', label: t.shell.rail.settings, icon: <Settings />, to: isAdmin ? '/settings/$section' : '/account' },
  ]
}

function DestinationLink({ destination, ...props }: { destination: Destination } & Omit<ComponentProps<'a'>, 'href'>) {
  return destination.to === '/settings/$section' ? (
    <Link to={destination.to} params={{ section: 'board' }} {...props} />
  ) : (
    <Link to={destination.to} {...props} />
  )
}

function UpdateDot({ identity }: { identity: Identity }) {
  const { t } = useI18n()
  const update = useReleaseUpdate(identity.superAdmin ?? false)
  if (!update) return null
  return (
    <>
      <span className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background" aria-hidden="true" />
      <span className="sr-only">{t.shell.rail.updateAvailable(update.latestVersion)}</span>
    </>
  )
}

export function AppRail({ active, identity, navigationEnabled }: { active: AppView; identity: Identity; navigationEnabled: boolean }) {
  const { t } = useI18n()
  const destinations = useDestinations(identity)
  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center gap-5 border-r-2 border-dashed border-blueprint/25 bg-background py-4 max-sm:hidden"
      data-hydrated={navigationEnabled}
    >
      {navigationEnabled ? (
        <Link to="/" className="text-inherit no-underline hover:opacity-85" aria-label={t.shell.rail.goToBoard}>
          <RailBrand />
        </Link>
      ) : (
        <span aria-label={t.shell.rail.goToBoard}>
          <RailBrand />
        </span>
      )}
      <nav className="flex flex-1 flex-col items-center gap-1" aria-label={t.shell.rail.mainNavigation}>
        {destinations.map((destination) => {
          const current = destination.view === active
          return (
            <Tooltip key={destination.view}>
              <TooltipTrigger
                render={
                  <DestinationLink
                    destination={destination}
                    className={cn(
                      'relative grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors [&>svg]:size-[18px] hover:bg-muted hover:text-foreground',
                      current && 'bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary',
                      !navigationEnabled && 'pointer-events-none opacity-50',
                    )}
                    aria-current={current ? 'page' : undefined}
                    aria-label={destination.label}
                  />
                }
              >
                {destination.icon}
                {destination.view === 'settings' && <UpdateDot identity={identity} />}
              </TooltipTrigger>
              <TooltipContent side="right">{destination.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
      {navigationEnabled && <StorageRemaining side="right" />}
      <AccountMenu />
    </aside>
  )
}

/** The phone layout's navigation: the same destinations as the rail, along the bottom edge where a thumb reaches. */
export function MobileNav({ active, identity, navigationEnabled }: { active: AppView; identity: Identity; navigationEnabled: boolean }) {
  const { t } = useI18n()
  const destinations = useDestinations(identity)
  return (
    <nav
      className="flex shrink-0 items-stretch border-t-2 border-dashed border-blueprint/25 bg-background px-1 pb-[env(safe-area-inset-bottom)] sm:hidden"
      aria-label={t.shell.rail.mainNavigation}
      data-hydrated={navigationEnabled}
    >
      {destinations.map((destination) => {
        const current = destination.view === active
        return (
          <DestinationLink
            key={destination.view}
            destination={destination}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] leading-none text-muted-foreground no-underline [&>svg]:size-5',
              current && 'text-primary',
              !navigationEnabled && 'pointer-events-none opacity-50',
            )}
            aria-current={current ? 'page' : undefined}
          >
            {destination.icon}
            <span className="max-w-full truncate">{destination.label}</span>
            {destination.view === 'settings' && <UpdateDot identity={identity} />}
          </DestinationLink>
        )
      })}
      {navigationEnabled && (
        <div className="flex flex-1 items-center justify-center empty:hidden">
          <StorageRemaining side="top" />
        </div>
      )}
      <div className="flex flex-1 items-center justify-center">
        <AccountMenu side="top" align="end" />
      </div>
    </nav>
  )
}

function StorageRemaining({ side }: { side: 'right' | 'top' }) {
  const { t, locale } = useI18n()
  const workspaceSlug = useWorkspaceSlug()
  const { data } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const [open, setOpen] = useState(false)
  const usage = data.managedStorageAccount
  if (!usage) return null
  // This is the signed-in account's allowance, so the offer follows their own plan rather than the
  // entitlement governing whichever workspace happens to be open.
  const upgrade = data.billing ? nextStoragePlan(data.billing.plan) : undefined
  const radius = 13
  const circumference = 2 * Math.PI * radius
  const usedBytes = Math.max(0, usage.quotaBytes - usage.availableBytes)
  const used = Math.max(0, Math.min(1, usedBytes / usage.quotaBytes))
  const level = storageUsageLevel(usedBytes, usage.quotaBytes)
  const label = t.shell.rail.storageAvailable(formatBytes(usage.availableBytes, locale))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="relative grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={label}
          />
        }
      >
        <svg className="absolute inset-0 size-9 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="opacity-15" />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - used)}
            className={level === 'ok' ? 'text-primary' : 'text-destructive'}
          />
        </svg>
        <HardDrive className="size-3.5" aria-hidden="true" />
        {level !== 'ok' && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-destructive ring-2 ring-background" aria-hidden="true" />
        )}
      </PopoverTrigger>
      <PopoverContent side={side} align="end" sideOffset={12} className="w-64 max-w-[calc(100vw-1rem)] gap-3 p-3">
        <span className="self-start rounded-sm border-2 border-blueprint/30 bg-background px-2 py-0.5 font-heading text-[11px] font-semibold tracking-[0.08em] text-foreground uppercase">
          {t.shell.rail.includedStorage}
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xl leading-none">{formatBytes(usedBytes, locale)}</span>
          <span className="text-xs text-muted-foreground">{t.shell.rail.storageUsedOf(formatBytes(usage.quotaBytes, locale))}</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn('h-full rounded-full', level === 'ok' ? 'bg-primary' : 'bg-destructive', usedBytes > 0 && 'min-w-[3px]')}
            style={{ width: `${used * 100}%` }}
          />
        </div>
        {level !== 'ok' && <p className="text-sm">{level === 'full' ? t.shell.rail.storageFull : t.shell.rail.storageNearlyFull}</p>}
        <div className="border-t border-dashed border-border pt-3">
          <Link to="/plan" className={cn(buttonVariants({ size: 'sm' }), 'w-full')} onClick={() => setOpen(false)}>
            {upgrade ? t.shell.rail.upgradeTo(t.settings.plan.names[upgrade]) : t.shell.rail.viewPlan}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
