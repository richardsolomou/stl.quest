import { useMutation } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Identity } from '../../core/types'
import { authClient } from '../authClient'

export function ImpersonationBanner({ identity }: { identity: Identity }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.stopImpersonating()
      if (error) throw new Error('Could not exit impersonation.')
    },
    onSuccess: () => window.location.assign('/'),
  })

  return (
    <div className="fixed right-3 bottom-3 z-50 w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg sm:right-4 sm:bottom-4 sm:w-auto sm:min-w-80">
      <div
        aria-hidden="true"
        className="h-1.5 w-full [background-image:repeating-linear-gradient(45deg,var(--chart-4)_0_10px,var(--background)_10px_20px)]"
      />
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Viewing as {identity.name}</p>
          <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          <LogOut />
          {mutation.isPending ? 'Exiting…' : 'Exit impersonation'}
        </Button>
      </div>
    </div>
  )
}
