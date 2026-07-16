import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createWorkspace, switchWorkspace } from '../../server/fns'
import { sessionQuery } from '../queries'
import { useWorkspaceSlug } from '../workspace'

const WORKSPACE_CHANGED_KEY = 'printhub-workspace-changed'

export function WorkspaceSwitcher({ className }: { className?: string }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const callCreate = useServerFn(createWorkspace)
  const callSwitch = useServerFn(switchWorkspace)
  const refreshWorkspace = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] })
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
  }, [queryClient])
  const activateWorkspace = async () => {
    await refreshWorkspace()
    localStorage.setItem(WORKSPACE_CHANGED_KEY, String(Date.now()))
  }
  useEffect(() => {
    const refreshOtherTab = (event: StorageEvent) => {
      if (event.key === WORKSPACE_CHANGED_KEY) void refreshWorkspace()
    }
    window.addEventListener('storage', refreshOtherTab)
    return () => window.removeEventListener('storage', refreshOtherTab)
  }, [refreshWorkspace])
  const createMutation = useMutation({
    mutationFn: (input: { data: { name: string } }) => callCreate(input),
    onSuccess: async () => {
      await activateWorkspace()
      setOpen(false)
      setName('')
    },
  })
  const switchMutation = useMutation({
    mutationFn: (workspaceId: string) => callSwitch({ data: { workspaceId } }),
    onSuccess: activateWorkspace,
  })
  const activeWorkspace = data.workspaces.find((workspace) => workspace.slug === workspaceSlug)

  return (
    <>
      <Select
        items={data.workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))}
        value={activeWorkspace?.id}
        onValueChange={(workspaceId) => workspaceId && workspaceId !== activeWorkspace?.id && switchMutation.mutate(workspaceId)}
      >
        <SelectTrigger className={cn('h-9 w-44', className)} aria-label="Workspace">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {data.workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
          <Button type="button" variant="ghost" size="sm" className="m-1 w-[calc(100%-0.5rem)] justify-start" onClick={() => setOpen(true)}>
            <Plus /> New workspace
          </Button>
        </SelectContent>
      </Select>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
