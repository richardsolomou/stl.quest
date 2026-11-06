import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Account } from '../../../core/types'
import { deleteAccount } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { invalidateQueries } from '../../queryState'
import { ConfirmDialog } from '../ConfirmDialog'
import { UserSummary } from '../UserSummary'
import { roleLabel } from './SuperAdminAccessDialogs'

export function DeleteUserDialog({ user, onDone, onDeleted }: { user: Account; onDone: () => void; onDeleted: (user: Account) => void }) {
  const { t } = useI18n()
  const copy = t.superAdmin.deleteUser
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
      title={copy.title}
      description={copy.description}
      details={<UserSummary user={user} role={roleLabel(user, t)} />}
      confirmLabel={copy.title}
      pendingLabel={copy.deleting}
      destructive
      pending={mutation.isPending}
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
