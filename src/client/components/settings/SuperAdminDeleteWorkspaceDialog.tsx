import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { AdminWorkspace } from '../../../core/admin'
import { deleteAdminWorkspace } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { ConfirmDialog } from '../ConfirmDialog'

export function DeleteWorkspaceDialog({
  workspace,
  onDone,
  onDeleted,
}: {
  workspace: AdminWorkspace
  onDone: () => void
  onDeleted: (workspace: AdminWorkspace) => void
}) {
  const queryClient = useQueryClient()
  const callDelete = useServerFn(deleteAdminWorkspace)
  const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({
    mutationFn: () => callDelete({ data: { id: workspace.id, confirmation } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'admin-workspaces', 'accounts')
      onDeleted(workspace)
      onDone()
    },
  })
  return (
    <ConfirmDialog
      open
      title="Delete workspace"
      description="This permanently deletes the workspace with its print requests, models, settings, and invitations. Members using it are moved to another of their workspaces, or to a new empty one if they have none. Connected cloud storage may keep its files. You cannot undo this."
      details={
        <Field>
          <FieldLabel htmlFor="admin-delete-workspace-confirmation">Workspace name</FieldLabel>
          <Input
            id="admin-delete-workspace-confirmation"
            className="ph-no-capture"
            value={confirmation}
            disabled={mutation.isPending}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FieldDescription>
            Enter <span className="ph-no-capture font-medium break-all text-foreground">{workspace.name}</span> exactly.
          </FieldDescription>
        </Field>
      }
      confirmLabel="Delete workspace"
      pendingLabel="Deleting…"
      destructive
      pending={mutation.isPending}
      confirmDisabled={confirmation !== workspace.name}
      problem={
        mutation.error
          ? {
              title: 'The workspace was not deleted',
              hint: 'Nothing was deleted and its members can keep working. Resolve the problem below, then try again.',
              error: mutation.error.message,
            }
          : undefined
      }
      onConfirm={() => mutation.mutate()}
      onCancel={onDone}
    />
  )
}
