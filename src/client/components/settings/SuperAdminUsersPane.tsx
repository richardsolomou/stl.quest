import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import type { Account } from '../../../core/types'
import { useI18n } from '../../i18n'
import { accountsQuery, sessionQuery } from '../../queries'
import { retryQueries } from '../../queryState'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsTableSection } from './SettingsLayout'
import { ChangeServerRoleDialog, ImpersonateUserDialog } from './SuperAdminAccessDialogs'
import { CreateUserDialog } from './SuperAdminCreateUserDialog'
import { DeleteUserDialog } from './SuperAdminDeleteUserDialog'
import { SelfSignupSetting } from './SelfSignupSetting'
import { SetPasswordDialog } from './SuperAdminPasswordDialog'
import { SuperAdminUserDetailDialog } from './SuperAdminUserDetailDialog'
import { accountPlanOptions, accountRoleOptions, superAdminUserColumns, type SuperAdminUserAction } from './SuperAdminUsersTable'

export function SuperAdminUsersPane({ hosted }: { hosted: boolean }) {
  const { t, locale } = useI18n()
  const copy = t.superAdmin.users
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
        <SettingsHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={usersResult.isPending || sessionResult.isPending}
          error={usersResult.error ?? sessionResult.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void retryQueries(usersResult.refetch, sessionResult.refetch)}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SelfSignupSetting enabled={session.auth.selfSignup} />
      <SettingNotice notice={notice} />
      <SettingsTableSection>
        <DataTable
          columns={superAdminUserColumns({
            t,
            locale,
            me: session.identity,
            hosted,
            passwordEnabled,
            onAction: (action, user) => {
              setNotice(undefined)
              setDialog({ action, user })
            },
          })}
          data={users}
          search={{ label: copy.searchLabel, placeholder: copy.searchPlaceholder }}
          filters={[
            {
              columnId: 'role',
              label: copy.filterByRole,
              allOption: { value: 'all', label: copy.allRoles },
              options: accountRoleOptions(t),
              className: 'w-44',
            },
            ...(hosted
              ? [
                  {
                    columnId: 'plan',
                    label: copy.filterByPlan,
                    allOption: { value: 'all', label: copy.allPlans },
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
            initial: { updatedAt: false, workspaceCount: false },
            labels: {
              email: t.superAdmin.columns.email,
              role: t.superAdmin.columns.role,
              createdAt: t.superAdmin.columns.created,
              updatedAt: t.superAdmin.columns.updated,
              lastOnlineAt: t.superAdmin.columns.lastOnline,
              workspaceCount: t.superAdmin.columns.workspaces,
              plan: t.superAdmin.columns.plan,
              storage: t.superAdmin.columns.includedStorage,
            },
          }}
          emptyMessage={copy.empty}
          itemLabel={{ singular: copy.itemSingular, plural: copy.itemPlural }}
          alignLastColumnRight
          onRowClick={(user) => {
            setNotice(undefined)
            setDialog({ action: 'details', user })
          }}
          getRowLabel={(user) => t.superAdmin.viewDetails(user.name)}
        />
      </SettingsTableSection>
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
              title: copy.passwordSetTitle(user.name),
              hint: copy.passwordSetHint,
            })
          }
        />
      )}
      {dialog?.action === 'delete' && (
        <DeleteUserDialog
          user={dialog.user}
          onDone={() => setDialog(null)}
          onDeleted={(user) =>
            setNotice({
              tone: 'success',
              title: copy.deletedTitle(user.name),
              hint: copy.deletedHint,
            })
          }
        />
      )}
      {adding && <CreateUserDialog passwordEnabled={passwordEnabled} onDone={() => setAdding(false)} />}
      <SettingsActions>
        <Button type="button" onClick={() => setAdding(true)}>
          {copy.add}
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}
