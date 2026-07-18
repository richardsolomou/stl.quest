import { useEffect, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Check, Info, LogOut, Plus, ShieldCheck } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { createWorkspace, switchWorkspace } from '../../server/fns'
import { authClient } from '../authClient'
import { sessionQuery } from '../queries'
import { reloadAfterWorkspaceChange, useWorkspaceSlug, WORKSPACE_CHANGED_KEY } from '../workspace'
import { UserAvatar } from './UserAvatar'

export function AccountMenu({ isDeploymentAdmin = false }: { isDeploymentAdmin?: boolean }) {
  const workspaceSlug = useWorkspaceSlug()
  const { data } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const identity = data.identity
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const callCreate = useServerFn(createWorkspace)
  const callSwitch = useServerFn(switchWorkspace)
  useEffect(() => {
    const refreshOtherTab = (event: StorageEvent) => {
      if (event.key === WORKSPACE_CHANGED_KEY) window.location.reload()
    }
    window.addEventListener('storage', refreshOtherTab)
    return () => window.removeEventListener('storage', refreshOtherTab)
  }, [])
  const createMutation = useMutation({
    mutationFn: (input: { data: { name: string } }) => callCreate(input),
    onSuccess: reloadAfterWorkspaceChange,
  })
  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) => callSwitch({ data: { workspaceId } }),
    onSuccess: reloadAfterWorkspaceChange,
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
        <PopoverContent align="end" className="w-72 max-w-[calc(100vw-1rem)] gap-2 p-2">
          <Link
            to="/account"
            className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Account settings"
            onClick={() => setMenuOpen(false)}
          >
            <UserAvatar name={identity.name} image={identity.image} />
            <div className="min-w-0">
              <p className="truncate font-medium">{identity.name}</p>
              <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
            </div>
          </Link>
          <Separator />
          <div className="px-2 pt-1 text-xs font-medium text-muted-foreground">Workspaces</div>
          <div className="flex flex-col gap-0.5">
            {data.workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                type="button"
                variant="ghost"
                className="w-full justify-start"
                disabled={switchMutation.isPending}
                aria-current={workspace.id === activeWorkspace?.id ? 'true' : undefined}
                onClick={() => workspace.id !== activeWorkspace?.id && switchMutation.mutate(workspace.id)}
              >
                <Check className={cn(workspace.id !== activeWorkspace?.id && 'invisible')} />
                <span className="truncate">{workspace.name}</span>
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start pl-8 text-xs text-muted-foreground"
              onClick={() => {
                setMenuOpen(false)
                setDialogOpen(true)
              }}
            >
              <Plus />
              Create workspace
            </Button>
          </div>
          <Separator />
          <div className="flex flex-col gap-0.5">
            <Link
              to="/about"
              className={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
              onClick={() => setMenuOpen(false)}
            >
              <Info />
              About
            </Link>
            {isDeploymentAdmin && (
              <Link
                to="/admin/$section"
                params={{ section: 'users' }}
                className={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}
                onClick={() => setMenuOpen(false)}
              >
                <ShieldCheck />
                Admin
              </Link>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={async () => {
                await authClient.signOut()
                setMenuOpen(false)
                await navigate({ to: '/' })
                await queryClient.invalidateQueries({ queryKey: ['session'] })
              }}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ data: { name: name.trim() } })}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
