import { useSuspenseQuery } from '@tanstack/react-query'
import { useHydrated, useNavigate } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { sessionQuery } from '../queries'
import { useEscape } from '../useEscape'
import { AppBar, MobileNav, type AppView } from './AppBar'
import { ProductTour } from './ProductTour'

/**
 * Every signed-in page: the bar across the top, its destinations moving to a bottom bar on phones, and one content column.
 * `fill` hands the whole area to a page that manages its own scrolling, such as the board. `contained` keeps the
 * padded column but holds it to the viewport, for a page whose list scrolls inside it, such as the archive.
 */
export function AppShell({
  active,
  fill = false,
  contained = false,
  children,
}: {
  active: AppView
  fill?: boolean
  contained?: boolean
  children: ReactNode
}) {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const hydrated = useHydrated()
  const navigate = useNavigate()
  const identity = session.identity
  // The board is the destination, so only the other pages send Escape there.
  useEscape(fill ? () => undefined : () => navigate({ to: '/' }))
  useEffect(() => {
    if (!identity) void navigate({ to: '/' })
  }, [identity, navigate])
  if (!identity) return null
  return (
    <div className="relative flex h-dvh flex-col">
      <AppBar active={active} identity={identity} navigationEnabled={hydrated} />
      <main className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', !fill && 'app-scrollbar overflow-y-auto overscroll-none')}>
        {fill ? (
          children
        ) : (
          <div className={cn('mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-6 pb-12 sm:px-6 sm:pt-7', contained && 'min-h-0')}>
            {children}
          </div>
        )}
      </main>
      <MobileNav active={active} identity={identity} navigationEnabled={hydrated} />
      {hydrated && <ProductTour isAdmin={identity.role === 'admin'} />}
    </div>
  )
}
