import { useQuery } from '@tanstack/react-query'
import { RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Identity } from '../../core/types'
import { releaseUpdateQuery } from '../queries'
import { clientNeedsRefresh } from '../updateNotices'

const DISMISSED_RELEASE_KEY = 'printhub.dismissedReleaseVersion'

export function UpdateNotices({ identity, hosted, serverVersion }: { identity?: Identity; hosted: boolean; serverVersion: string }) {
  const releaseQuery = useQuery(releaseUpdateQuery(Boolean(identity?.superAdmin && typeof window !== 'undefined')))
  const [dismissedRelease, setDismissedRelease] = useState(() =>
    typeof window === 'undefined' ? undefined : window.localStorage.getItem(DISMISSED_RELEASE_KEY),
  )

  if (clientNeedsRefresh(serverVersion, __APP_VERSION__)) {
    return (
      <div className="fixed right-3 bottom-3 left-3 z-50 flex items-center gap-2 rounded-lg border bg-popover/95 p-2 shadow-lg backdrop-blur sm:right-auto sm:left-1/2 sm:-translate-x-1/2">
        <span className="whitespace-nowrap px-2 text-sm font-medium">PrintHub has been updated.</span>
        <Button type="button" size="sm" onClick={() => window.location.reload()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>
    )
  }

  const update = releaseQuery.data?.update
  if (!update || dismissedRelease === update.latestVersion) return null

  const dismiss = () => {
    window.localStorage.setItem(DISMISSED_RELEASE_KEY, update.latestVersion)
    setDismissedRelease(update.latestVersion)
  }

  return (
    <aside className="sticky top-0 z-50 flex items-center justify-center gap-3 border-b-2 border-dashed border-blueprint/40 bg-accent px-4 py-2 text-sm text-accent-foreground shadow-sm">
      <span>PrintHub v{update.latestVersion} is available.</span>
      <a className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))} href={update.releaseUrl} target="_blank" rel="noreferrer">
        {hosted ? 'View what’s new' : 'View release'}
      </a>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Dismiss version ${update.latestVersion} notice`} onClick={dismiss}>
        <X />
      </Button>
    </aside>
  )
}
