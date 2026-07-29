import { type ReactNode, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HardDrive, LayoutDashboard, Settings } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { RailBrand } from './Brand'
import { sessionQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { formatBytes } from '../../core/format'
import { nextStoragePlan, storagePlans, storageUsageLevel } from '../../core/plans'

type AppView = 'board' | 'settings' | 'account' | 'admin'

export function AppRail({
  active,
  isAdmin,
  isSuperAdmin = false,
  navigationEnabled = true,
}: {
  active: AppView
  isAdmin: boolean
  isSuperAdmin?: boolean
  navigationEnabled?: boolean
}) {
  return (
    <aside
      className="flex w-14 shrink-0 flex-col items-center gap-5 border-r-2 border-dashed border-blueprint/25 bg-background py-4"
      data-hydrated={navigationEnabled}
    >
      {navigationEnabled ? (
        <Link to="/" className="text-inherit no-underline hover:opacity-85" aria-label="Go to board">
          <RailBrand />
        </Link>
      ) : (
        <span aria-label="Go to board">
          <RailBrand />
        </span>
      )}
      <nav className="flex flex-1 flex-col items-center gap-1" aria-label="Main navigation">
        <RailLink active={active === 'board'} enabled={navigationEnabled} to="/" label="Board" icon={<LayoutDashboard />} />
        {isAdmin && (
          <RailLink
            active={active === 'settings'}
            enabled={navigationEnabled}
            to="/settings/$section"
            label="Settings"
            icon={<Settings />}
          />
        )}
      </nav>
      {navigationEnabled && <StorageRemaining />}
      <AccountMenu isSuperAdmin={isSuperAdmin} />
    </aside>
  )
}

function StorageRemaining() {
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
  const label = `${formatBytes(usage.availableBytes)} storage available`
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
      <PopoverContent side="right" align="end" sideOffset={12} className="w-64 max-w-[calc(100vw-1rem)] gap-3 p-3">
        <span className="self-start rounded-sm border-2 border-blueprint/30 bg-background px-2 py-0.5 font-heading text-[11px] font-semibold tracking-[0.08em] text-foreground uppercase">
          Included storage
        </span>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-heading text-xl leading-none">{formatBytes(usedBytes)}</span>
          <span className="text-xs text-muted-foreground">of {formatBytes(usage.quotaBytes)} used</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn('h-full rounded-full', level === 'ok' ? 'bg-primary' : 'bg-destructive', usedBytes > 0 && 'min-w-[3px]')}
            style={{ width: `${used * 100}%` }}
          />
        </div>
        {level !== 'ok' && (
          <p className="text-sm">{level === 'full' ? 'Storage is full, so new uploads will fail.' : 'Storage is nearly full.'}</p>
        )}
        <div className="border-t border-dashed border-border pt-3">
          <Link to="/plan" className={cn(buttonVariants({ size: 'sm' }), 'w-full')} onClick={() => setOpen(false)}>
            {upgrade ? `Upgrade to ${storagePlans[upgrade].name}` : 'View plan'}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RailLink({
  active,
  enabled,
  to,
  label,
  icon,
}: {
  active: boolean
  enabled: boolean
  to: '/' | '/settings/$section'
  label: string
  icon: ReactNode
}) {
  const className = cn(
    'grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors [&>svg]:size-[18px] hover:bg-muted hover:text-foreground',
    active && 'bg-primary/15 text-primary hover:bg-primary/15 hover:text-primary',
    !enabled && 'pointer-events-none opacity-50',
  )
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          to === '/settings/$section' ? (
            <Link
              to={to}
              params={{ section: 'board' }}
              className={className}
              aria-current={active ? 'page' : undefined}
              aria-label={label}
            />
          ) : (
            <Link to={to} className={className} aria-current={active ? 'page' : undefined} aria-label={label} />
          )
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
