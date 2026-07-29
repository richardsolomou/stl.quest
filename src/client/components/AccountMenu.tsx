import { useEffect, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { Check, CreditCard, Info, LogOut, Plus, ShieldCheck, UserCog } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { createWorkspace, switchWorkspace } from '../../server/fns'
import { authClient } from '../authClient'
import { sessionQuery } from '../queries'
import { reloadAfterWorkspaceChange, useWorkspaceSlug, WORKSPACE_CHANGED_KEY } from '../workspace'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { useReleaseUpdate } from './ReleaseUpdateNotice'
import { UserAvatar } from './UserAvatar'
import { ProtectedEmail } from './ProtectedEmail'

export function AccountMenu({ isSuperAdmin = false, side = 'top' }: { isSuperAdmin?: boolean; side?: 'top' | 'bottom' }) {
  const workspaceSlug = useWorkspaceSlug()
  const { data } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const identity = data.identity
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const posthog = usePostHog()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const callCreate = useServerFn(createWorkspace)
  const callSwitch = useServerFn(switchWorkspace)
  const releaseUpdate = useReleaseUpdate(isSuperAdmin)
  useEffect(() => {
    const refreshOtherTab = (event: StorageEvent) => {
      if (event.key === WORKSPACE_CHANGED_KEY) window.location.reload()
    }
    window.addEventListener('storage', refreshOtherTab)
    return () => window.removeEventListener('storage', refreshOtherTab)
  }, [])
  const createMutation = useMutation({
    mutationFn: (input: { data: { name: string } }) => callCreate(input),
    onSuccess: () => {
      posthog.capture('workspace_created')
      reloadAfterWorkspaceChange()
    },
  })
  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) => callSwitch({ data: { workspaceId } }),
    onSuccess: () => {
      posthog.capture('workspace_switched')
      reloadAfterWorkspaceChange()
    },
  })
  const activeWorkspace = data.workspaces.find((workspace) => workspace.slug === workspaceSlug)

  if (!identity) return null

  return (
    <>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost" size="icon" className="cursor-pointer rounded-full" aria-label="Open account menu" />
          }
        >
          <UserAvatar name={identity.name} image={identity.image} />
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align={side === 'top' ? 'start' : 'end'}
          sideOffset={12}
          className="w-72 max-w-[calc(100vw-1rem)] gap-2 p-2"
        >
          <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-foreground">
            <UserAvatar name={identity.name} image={identity.image} />
            <div className="min-w-0">
              <div className="ph-no-capture truncate font-medium">{identity.name}</div>
              <ProtectedEmail email={identity.email} className="block text-xs text-muted-foreground" />
            </div>
          </div>
          <Separator />
          <div className="px-2 pt-1 font-heading text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Workspaces
          </div>
          <div className="flex flex-col gap-0.5">
            {data.workspaces.map((workspace) => {
              const active = workspace.id === activeWorkspace?.id
              return (
                <Button
                  key={workspace.id}
                  type="button"
                  variant="ghost"
                  className={cn('w-full justify-start', active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary')}
                  disabled={switchMutation.isPending}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => !active && switchMutation.mutate(workspace.id)}
                >
                  <Check className={cn(!active && 'invisible')} />
                  <span className="ph-no-capture truncate">{workspace.name}</span>
                </Button>
              )
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-xs text-muted-foreground"
              disabled={!data.canCreateWorkspace}
              onClick={() => {
                setMenuOpen(false)
                setDialogOpen(true)
              }}
            >
              <Plus />
              {data.canCreateWorkspace ? 'Create workspace' : '3 workspace limit reached'}
            </Button>
          </div>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <Link
              to="/account"
              className={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
              onClick={() => setMenuOpen(false)}
            >
              <UserCog />
              Account
            </Link>
            {data.billing?.available && (
              <Link
                to="/plan"
                className={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
                onClick={() => setMenuOpen(false)}
              >
                <CreditCard />
                Plan
                <span className="ml-auto text-xs font-medium text-muted-foreground">{data.billing.plans[data.billing.plan].name}</span>
              </Link>
            )}
          </div>
          {/* A full-bleed footer, so the width of the row belongs to the bar rather than reading as
              space around three small controls. */}
          <div className="-mx-2 -mb-2 flex items-center justify-between gap-1 rounded-b-lg border-t border-border bg-muted/40 px-3 py-1.5">
            <Link
              to="/about"
              className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setMenuOpen(false)}
            >
              <Info className="size-3.5" />
              About
            </Link>
            {isSuperAdmin && (
              <Link
                to="/admin/$section"
                params={{ section: 'users' }}
                className="flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
                <ShieldCheck className="size-3.5" />
                Admin
                {releaseUpdate && (
                  <span
                    className="size-1.5 rounded-full bg-primary"
                    aria-label={`STL Quest v${releaseUpdate.latestVersion} is available`}
                  />
                )}
              </Link>
            )}
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={async () => {
                await authClient.signOut()
                posthog.capture('user_signed_out')
                posthog.reset()
                setMenuOpen(false)
                await navigate({ to: '/' })
                await queryClient.invalidateQueries({ queryKey: ['session'] })
              }}
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {dialogOpen && (
        <DialogShell
          open
          title="Create workspace"
          description={
            data.billing?.available
              ? 'A workspace has its own board, members, and printers. Workspaces using included storage share your account’s plan allowance.'
              : 'A workspace has its own board, members, and printers.'
          }
          onClose={() => setDialogOpen(false)}
        >
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="new-workspace-name">Workspace name</FieldLabel>
              <Input id="new-workspace-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Design studio" />
            </Field>
            <DialogProblem
              title="Workspace was not created"
              hint="Check the name is not already in use, then try again."
              error={createMutation.error?.message}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ data: { name: name.trim() } })}
              >
                {createMutation.isPending && <Spinner />}
                {createMutation.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </div>
        </DialogShell>
      )}
    </>
  )
}
