import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Layers3, LayoutDashboard, Settings } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { Brand } from './Brand'

type AppView = 'board' | 'planner' | 'settings' | 'account' | 'admin'

export function AppHeader({
  active,
  isAdmin,
  isDeploymentAdmin = false,
  showPlanner = true,
  navigationEnabled = true,
}: {
  active: AppView
  isAdmin: boolean
  isDeploymentAdmin?: boolean
  showPlanner?: boolean
  navigationEnabled?: boolean
}) {
  return (
    <header
      className="flex min-h-15 items-center gap-4 border-b bg-background px-5 py-3.5 max-sm:min-h-0 max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-2.5"
      data-hydrated={navigationEnabled}
    >
      {navigationEnabled ? (
        <Link to="/" className="text-inherit no-underline hover:opacity-85" aria-label="Go to board">
          <Brand />
        </Link>
      ) : (
        <span aria-label="Go to board">
          <Brand />
        </span>
      )}
      <nav
        className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 max-sm:order-3 max-sm:w-full max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
        aria-label="Main navigation"
      >
        <AppHeaderLink active={active === 'board'} enabled={navigationEnabled} to="/" label="Board" icon={<LayoutDashboard />} />
        {isAdmin && showPlanner && (
          <AppHeaderLink active={active === 'planner'} enabled={navigationEnabled} to="/planner" label="Planner" icon={<Layers3 />} />
        )}
        {isAdmin && (
          <AppHeaderLink
            active={active === 'settings'}
            enabled={navigationEnabled}
            to="/settings/$section"
            label="Settings"
            icon={<Settings />}
          />
        )}
      </nav>
      <span className="flex-1" />
      <AccountMenu isDeploymentAdmin={isDeploymentAdmin} />
    </header>
  )
}

function AppHeaderLink({
  active,
  enabled,
  to,
  label,
  icon,
}: {
  active: boolean
  enabled: boolean
  to: '/' | '/planner' | '/settings/$section'
  label: string
  icon: ReactNode
}) {
  const className = cn(
    buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }),
    'h-8 gap-1.5 px-2.5',
    active && 'bg-background shadow-sm hover:bg-background',
    !enabled && 'pointer-events-none opacity-50',
  )
  const content = (
    <>
      {icon}
      {label}
    </>
  )
  if (to === '/settings/$section')
    return (
      <Link to={to} params={{ section: 'board' }} className={className} aria-current={active ? 'page' : undefined}>
        {content}
      </Link>
    )
  return (
    <Link to={to} className={className} aria-current={active ? 'page' : undefined}>
      {content}
    </Link>
  )
}
