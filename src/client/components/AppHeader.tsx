import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Layers3, LayoutDashboard, Settings } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Brand } from './Brand'

type AppView = 'board' | 'planner' | 'settings'

export function AppHeader({
  active,
  isAdmin,
  navigationEnabled = true,
  children,
}: {
  active: AppView
  isAdmin: boolean
  navigationEnabled?: boolean
  children?: ReactNode
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
      <nav className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 max-sm:order-3 max-sm:w-full" aria-label="Main navigation">
        <AppHeaderLink active={active === 'board'} enabled={navigationEnabled} to="/" label="Board" icon={<LayoutDashboard />} />
        {isAdmin && (
          <AppHeaderLink active={active === 'planner'} enabled={navigationEnabled} to="/planner" label="Planner" icon={<Layers3 />} />
        )}
        <AppHeaderLink
          active={active === 'settings'}
          enabled={navigationEnabled}
          to="/settings/$section"
          params={{ section: 'account' }}
          label="Settings"
          icon={<Settings />}
        />
      </nav>
      <span className="flex-1 max-sm:hidden" />
      <div className="flex h-8 min-w-24 items-center justify-end gap-2 max-sm:ml-auto max-sm:min-w-8">{children}</div>
    </header>
  )
}

function AppHeaderLink({
  active,
  enabled,
  to,
  params,
  label,
  icon,
}: {
  active: boolean
  enabled: boolean
  to: '/' | '/planner' | '/settings/$section'
  params?: { section: 'account' }
  label: string
  icon: ReactNode
}) {
  const className = cn(
    buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }),
    'h-8 gap-1.5 px-2.5',
    active && 'bg-background shadow-sm hover:bg-background',
    !enabled && 'pointer-events-none opacity-50',
  )
  if (to === '/settings/$section') {
    return (
      <Link to={to} params={params!} className={className} aria-current={active ? 'page' : undefined}>
        {icon}
        {label}
      </Link>
    )
  }
  return (
    <Link to={to} className={className} aria-current={active ? 'page' : undefined}>
      {icon}
      {label}
    </Link>
  )
}
