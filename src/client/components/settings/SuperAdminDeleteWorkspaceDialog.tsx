import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { AdminWorkspace } from '../../../core/admin'
import { deleteAdminWorkspace } from '../../../server/fns'
import { useI18n } from '../../i18n'
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
  const { t } = useI18n()
  const copy = t.superAdmin.deleteWorkspace
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
      title={copy.title}
      description={copy.description}
      details={
        <Field>
          <FieldLabel htmlFor="admin-delete-workspace-confirmation">{copy.nameLabel}</FieldLabel>
          <Input
            id="admin-delete-workspace-confirmation"
            className="ph-no-capture"
            value={confirmation}
            disabled={mutation.isPending}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <FieldDescription>
            {copy.enterExactly.before}
            <span className="ph-no-capture font-medium break-all text-foreground">{workspace.name}</span>
            {copy.enterExactly.after}
          </FieldDescription>
        </Field>
      }
      confirmLabel={copy.title}
      pendingLabel={copy.deleting}
      destructive
      pending={mutation.isPending}
      confirmDisabled={confirmation !== workspace.name}
      problem={
        mutation.error
          ? {
              title: copy.problemTitle,
              hint: copy.problemHint,
              error: mutation.error.message,
            }
          : undefined
      }
      onConfirm={() => mutation.mutate()}
      onCancel={onDone}
    />
  )
}
