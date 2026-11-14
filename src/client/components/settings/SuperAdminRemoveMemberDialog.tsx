import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { AdminWorkspaceMember } from '../../../core/admin'
import { removeAdminWorkspaceMember } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { ConfirmDialog } from '../ConfirmDialog'
import { UserSummary } from '../UserSummary'
import { invalidateSuperAdminMembership } from './SuperAdminAddMemberForm'

export function SuperAdminRemoveMemberDialog({
  workspaceId,
  member,
  onDone,
}: {
  workspaceId: string
  member: AdminWorkspaceMember
  onDone: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.members
  const queryClient = useQueryClient()
  const callRemove = useServerFn(removeAdminWorkspaceMember)
  const mutation = useMutation({
    mutationFn: () => callRemove({ data: { id: workspaceId, userId: member.id } }),
    onSuccess: async () => {
      await invalidateSuperAdminMembership(queryClient)
      onDone()
    },
  })
  return (
    <ConfirmDialog
      open
      title={copy.actions.remove}
      description={copy.remove.description}
      details={<UserSummary user={member} role={t.superAdmin.workspaceRoles[member.role]} />}
      confirmLabel={copy.actions.remove}
      destructive
      pending={mutation.isPending}
      problem={
        mutation.error ? { title: copy.remove.notRemoved, hint: copy.remove.notRemovedHint, error: mutation.error.message } : undefined
      }
      onConfirm={() => mutation.mutate()}
      onCancel={onDone}
    />
  )
}
