import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { Account } from '../../../core/types'
import { deleteAccount } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { UserSummary } from '../UserSummary'

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
    <DialogShell title="Delete user" onClose={onDone} preventClose={mutation.isPending}>
      <UserSummary user={user} role={user.role === 'super_admin' ? 'Super admin' : 'User'} />
      <p className="text-sm text-muted-foreground">
        This permanently deletes the account and signs the user out everywhere. Their print requests and models are deleted from every
        workspace. Workspaces where they are the only member are deleted too. You cannot undo this.
      </p>
      <DialogProblem
        title="The user was not deleted"
        hint="Their account still works. If they are the only owner of a workspace with other members, remove those members or delete that workspace first."
        error={mutation.error?.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending && <Spinner />}
          Delete user
        </Button>
      </div>
    </DialogShell>
  )
}
