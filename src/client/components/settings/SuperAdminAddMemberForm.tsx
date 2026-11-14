import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Account, AssignableWorkspaceRole } from '../../../core/types'
import { addAdminWorkspaceMember } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { accountsQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { QueryState } from '../QueryState'

/** Deployment-wide admin views do not subscribe to the target workspace's realtime channel. */
export async function invalidateSuperAdminMembership(queryClient: QueryClient) {
  await invalidateQueries(queryClient, 'admin-workspace', 'admin-workspaces', 'admin-account', 'accounts', 'users', 'people')
}

export function SuperAdminAddMemberForm({
  workspace,
  onAdded,
}: {
  workspace: { id: string; members: Array<{ id: string }> }
  onAdded?: () => void
}) {
  const anchor = useComboboxAnchor()
  const { t } = useI18n()
  const copy = t.superAdmin.workspaceDetails
  const accounts = useQuery(accountsQuery())
  const queryClient = useQueryClient()
  const callAdd = useServerFn(addAdminWorkspaceMember)
  const [selected, setSelected] = useState<Account | null>(null)
  const [role, setRole] = useState<AssignableWorkspaceRole>('member')
  const roleOptions = [
    { value: 'member', label: t.superAdmin.workspaceRoles.member },
    { value: 'admin', label: t.superAdmin.workspaceRoles.admin },
  ] as const
  const options = (accounts.data ?? []).filter((account) => !workspace.members.some((member) => member.id === account.id))
  const mutation = useMutation({
    mutationFn: (userId: string) => callAdd({ data: { id: workspace.id, userId, role } }),
    onSuccess: async () => {
      setSelected(null)
      await invalidateSuperAdminMembership(queryClient)
      onAdded?.()
    },
  })
  if (!accounts.data)
    return (
      <QueryState
        loading={accounts.isPending}
        error={accounts.error}
        loadingLabel={t.superAdmin.users.loading}
        errorTitle={copy.addError}
        onRetry={() => void accounts.refetch()}
      />
    )
  return (
    <form
      className="space-y-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (selected && options.some((account) => account.id === selected.id) && !mutation.isPending) mutation.mutate(selected.id)
      }}
    >
      <Field>
        <FieldLabel htmlFor="admin-add-member">{copy.addUser}</FieldLabel>
        <FieldDescription>{copy.addHint}</FieldDescription>
        <Combobox
          items={options}
          value={selected}
          onValueChange={setSelected}
          itemToStringLabel={(account: Account) => `${account.name} (${account.email})`}
          disabled={mutation.isPending}
        >
          <div ref={anchor}>
            <ComboboxInput id="admin-add-member" placeholder={copy.searchAccounts} className="ph-no-capture w-full min-w-0" />
          </div>
          <ComboboxContent anchor={anchor} className="ph-no-capture min-w-0">
            <ComboboxEmpty>{copy.noAccounts}</ComboboxEmpty>
            <ComboboxList>
              {(account: Account) => (
                <ComboboxItem key={account.id} value={account} className="min-w-0">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {account.name} ({account.email})
                  </span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="admin-add-member-role">{copy.role}</FieldLabel>
          <Select
            items={roleOptions}
            value={role}
            onValueChange={(value) => setRole(value as AssignableWorkspaceRole)}
            disabled={mutation.isPending}
          >
            <SelectTrigger className="w-40" id="admin-add-member-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button type="submit" disabled={!selected || !options.some((account) => account.id === selected.id) || mutation.isPending}>
          {mutation.isPending ? copy.adding : copy.addUser}
        </Button>
      </div>
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {copy.addError}: {mutation.error.message}
        </p>
      )}
    </form>
  )
}
