import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Identity } from '../../../core/types'
import { deleteWorkspace, updateBoardSettings } from '../../../server/fns'
import { boardQuery } from '../../queries'
import { reloadAfterWorkspaceChange, useWorkspaceSlug } from '../../workspace'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const VISIBILITY_OPTIONS = [
  { value: 'shared', label: 'Shared — everyone sees every request' },
  { value: 'private', label: 'Private — requesters see only their own' },
] as const

export function BoardPane({ me, workspaceName, workspaceCount }: { me: Identity; workspaceName: string; workspaceCount: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const { data: current } = useQuery(boardQuery(workspaceSlug))
  const callUpdate = useServerFn(updateBoardSettings)
  const callDelete = useServerFn(deleteWorkspace)
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['board-settings'] })
      toast.success('Board settings saved.')
    },
  })
  const deleteMutation = useMutation({
    mutationFn: callDelete,
    onSuccess: reloadAfterWorkspaceChange,
  })
  const owner = me.workspaceRole === 'owner'
  const onlyWorkspace = workspaceCount <= 1
  if (!current) return <SettingsHeader title="Board" description="Loading board settings…" />

  return (
    <SettingsPage>
      <SettingsHeader title="Board" description="Control how requests are shared between admins and requesters." />
      <SettingsSection>
        <Field>
          <FieldLabel htmlFor="board-visibility">Request visibility</FieldLabel>
          <Select
            items={VISIBILITY_OPTIONS}
            value={current.privateRequests ? 'private' : 'shared'}
            disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate({ data: { workspaceSlug, privateRequests: value === 'private' } })}
          >
            <SelectTrigger className="w-full" id="board-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Private suits print farms and paid work: requesters see, reorder, and withdraw only their own requests. Admins always see
            everything.
          </FieldDescription>
        </Field>
        <FieldError>{mutation.error?.message || (mutation.error ? 'Could not save board settings.' : '')}</FieldError>
      </SettingsSection>
      <SettingsSection
        title="Danger zone"
        description="Permanently remove this workspace, its requests, settings, members, and locally stored workspace files. Connected cloud storage may retain files."
      >
        <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 max-sm:items-start max-sm:flex-col">
          <div>
            <h3 className="font-medium">Delete {workspaceName}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {!owner
                ? 'Only the workspace owner can delete this workspace.'
                : onlyWorkspace
                  ? 'Create another workspace before deleting this one.'
                  : 'This cannot be undone.'}
            </p>
          </div>
          <Button type="button" variant="destructive" disabled={!owner || onlyWorkspace} onClick={() => setDeleteOpen(true)}>
            Delete workspace
          </Button>
        </div>
      </SettingsSection>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (open || deleteMutation.isPending) return
          setDeleteOpen(false)
          setConfirmation('')
          deleteMutation.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {workspaceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workspace and its PrintHub data. Type the workspace name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-workspace-confirmation">Workspace name</FieldLabel>
            <Input
              id="delete-workspace-confirmation"
              value={confirmation}
              disabled={deleteMutation.isPending}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <FieldDescription>Enter {workspaceName} exactly.</FieldDescription>
            <FieldError>{deleteMutation.error?.message}</FieldError>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmation !== workspaceName || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ data: { workspaceSlug, confirmation } })}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
