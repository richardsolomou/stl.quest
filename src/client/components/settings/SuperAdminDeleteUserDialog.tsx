import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Account } from '../../../core/types'
import { deleteAccount } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { ConfirmDialog } from '../ConfirmDialog'
import { UserSummary } from '../UserSummary'
import { roleLabel } from './SuperAdminAccessDialogs'

export function DeleteUserDialog({ user, onDone, onDeleted }: { user: Account; onDone: () => void; onDeleted: (user: Account) => void }) {
  const queryClient = useQueryClient()
  const callDelete = useServerFn(deleteAccount)
  const mutation = useMutation({
    mutationFn: () => callDelete({ data: { id: user.id } }),
    onSuccess: async () => {
      await invalidateQueries(queryClient, 'accounts', 'admin-workspaces')
      onDeleted(user)
      onDone()
    },
  })
  return (
    <ConfirmDialog
      open
      title="Delete user"
      description="This permanently deletes the account and signs the user out everywhere. Their print requests and models are deleted from every workspace. Workspaces where they are the only member are deleted too. You cannot undo this."
      details={<UserSummary user={user} role={roleLabel(user)} />}
      confirmLabel="Delete user"
      pendingLabel="Deleting…"
      destructive
      pending={mutation.isPending}
      problem={
        mutation.error
          ? {
              title: 'The user was not deleted',
              hint: 'Nothing was deleted and their account still works. Resolve the problem below, then try again.',
              error: mutation.error.message,
            }
          : undefined
      }
      onConfirm={() => mutation.mutate()}
      onCancel={onDone}
    />
  )
}
