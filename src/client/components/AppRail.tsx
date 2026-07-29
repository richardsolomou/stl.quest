import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { HardDrive, LayoutDashboard, Settings } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { RailBrand } from './Brand'
import { formatBytes } from '../../core/format'

type AppView = 'board' | 'settings' | 'account' | 'admin'

export function AppRail({
  active,
  isAdmin,
  isSuperAdmin = false,
  navigationEnabled = true,
  managedStorageUsage,
}: {
  active: AppView
  isAdmin: boolean
  isSuperAdmin?: boolean
  navigationEnabled?: boolean
  managedStorageUsage?: { availableBytes: number; quotaBytes: number }
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
      {isAdmin && managedStorageUsage && navigationEnabled && <StorageRemaining usage={managedStorageUsage} />}
      <AccountMenu isSuperAdmin={isSuperAdmin} />
    </aside>
  )
}

function StorageRemaining({ usage }: { usage: { availableBytes: number; quotaBytes: number } }) {
  const radius = 13
  const circumference = 2 * Math.PI * radius
  const used = Math.max(0, Math.min(1, 1 - usage.availableBytes / usage.quotaBytes))
  const label = `${formatBytes(usage.availableBytes)} storage available`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            to="/settings/$section"
            params={{ section: 'storage' }}
            className="relative grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
            className={used >= 0.9 ? 'text-destructive' : 'text-primary'}
          />
        </svg>
        <HardDrive className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
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
