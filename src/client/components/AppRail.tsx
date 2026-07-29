import { type ReactNode, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HardDrive, LayoutDashboard, Settings } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { RailBrand } from './Brand'
import { StorageUpgradeAction } from './StorageUpgradeAction'
import { sessionQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'
import { formatBytes } from '../../core/format'
import { storageUsageLevel } from '../../core/plans'

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
      <PopoverContent side="right" align="end" sideOffset={12} className="w-72 max-w-[calc(100vw-1rem)] gap-3 p-2">
        <div className="px-2 pt-1">
          <div className="font-medium">Included storage</div>
          <p className="text-xs text-muted-foreground">
            {formatBytes(usedBytes)} of {formatBytes(usage.quotaBytes)} used
          </p>
        </div>
        <Progress value={used * 100} aria-label="Included storage usage" className="mx-2 w-auto" />
        {level !== 'ok' && (
          <p className="px-2 text-sm">{level === 'full' ? 'Storage is full, so new uploads will fail.' : 'Storage is nearly full.'}</p>
        )}
        <StorageUpgradeAction className="mx-2 self-start" onNavigate={() => setOpen(false)} />
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
