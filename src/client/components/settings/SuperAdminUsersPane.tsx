import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import type { Account } from '../../../core/types'
import { accountsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { ChangeServerRoleDialog, ImpersonateUserDialog } from './SuperAdminAccessDialogs'
import { CreateUserDialog } from './SuperAdminCreateUserDialog'
import { SetPasswordDialog } from './SuperAdminPasswordDialog'
import { SuperAdminUserDetailDialog } from './SuperAdminUserDetailDialog'
import { accountPlanOptions, accountRoleOptions, superAdminUserColumns, type SuperAdminUserAction } from './SuperAdminUsersTable'

export function SuperAdminUsersPane({ hosted }: { hosted: boolean }) {
  const usersResult = useQuery(accountsQuery())
  const sessionResult = useQuery(sessionQuery())
  const users = usersResult.data
  const session = sessionResult.data
  const passwordEnabled = session?.auth.password !== false
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<{ action: SuperAdminUserAction; user: Account } | null>(null)
  const [notice, setNotice] = useState<Notice>()

  if (!users || !session) {
    return (
      <SettingsPage>
        <SettingsHeader title="Users" description="Manage every account and super admin." />
        <QueryState
          loading={usersResult.isPending || sessionResult.isPending}
          error={usersResult.error ?? sessionResult.error}
          loadingLabel="Loading users…"
          errorTitle="Could not load users"
          onRetry={() => void retryQueries(usersResult.refetch, sessionResult.refetch)}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Users" description="Manage every account and super admin." />
      <SettingNotice notice={notice} />
      <SettingsSection className="p-0 max-sm:[&_td]:px-1.5 max-sm:[&_td:nth-child(2)]:hidden max-sm:[&_th]:px-1.5 max-sm:[&_th:nth-child(2)]:hidden">
        <DataTable
          columns={superAdminUserColumns({
            me: session.identity,
            hosted,
            passwordEnabled,
            onAction: (action, user) => {
              setNotice(undefined)
              setDialog({ action, user })
            },
          })}
          data={users}
          search={{ label: 'Search users', placeholder: 'Search users…' }}
          filters={[
            {
              columnId: 'role',
              label: 'Filter users by role',
              allOption: { value: 'all', label: 'All roles' },
              options: accountRoleOptions,
              className: 'w-44',
            },
            ...(hosted
              ? [
                  {
                    columnId: 'plan',
                    label: 'Filter users by plan',
                    allOption: { value: 'all', label: 'All plans' },
                    options: accountPlanOptions,
                    className: 'w-40',
                  },
                ]
              : []),
          ]}
          initialSorting={[{ id: 'lastOnlineAt', desc: true }]}
          sortingStorageKey="stlquest:super-admin-users:sorting"
          columnVisibility={{
            storageKey: 'stlquest:super-admin-users:columns',
            initial: { updatedAt: false },
            labels: {
              email: 'Email',
              role: 'Role',
              createdAt: 'Created',
              updatedAt: 'Updated',
              lastOnlineAt: 'Last online',
              workspaceCount: 'Workspaces',
              plan: 'Plan',
              storage: 'Included storage',
            },
          }}
          emptyMessage="No users match these filters."
          itemLabel={{ singular: 'user', plural: 'users' }}
          alignLastColumnRight
          onRowClick={(user) => {
            setNotice(undefined)
            setDialog({ action: 'details', user })
          }}
          getRowLabel={(user) => `View details for ${user.name}`}
        />
      </SettingsSection>
      {dialog?.action === 'details' && <SuperAdminUserDetailDialog user={dialog.user} hosted={hosted} onDone={() => setDialog(null)} />}
      {dialog?.action === 'impersonate' && <ImpersonateUserDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'role' && <ChangeServerRoleDialog user={dialog.user} onDone={() => setDialog(null)} />}
      {dialog?.action === 'password' && (
        <SetPasswordDialog
          user={dialog.user}
          onDone={() => setDialog(null)}
          onSaved={(user) =>
            setNotice({
              tone: 'success',
              title: `New password set for ${user.name}`,
              hint: 'They have been signed out everywhere and need the new password to sign back in.',
            })
          }
        />
      )}
      {adding && <CreateUserDialog passwordEnabled={passwordEnabled} onDone={() => setAdding(false)} />}
      <SettingsActions>
        <Button type="button" onClick={() => setAdding(true)}>
          Add user
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}
