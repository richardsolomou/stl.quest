import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@/components/ui/data-table'
import type { AdminWorkspace } from '../../../core/admin'
import { useI18n } from '../../i18n'
import { adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsTableSection } from './SettingsLayout'
import { DeleteWorkspaceDialog } from './SuperAdminDeleteWorkspaceDialog'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'
import { adminWorkspaceHealthOptions, superAdminWorkspaceColumns } from './SuperAdminWorkspacesTable'

export function SuperAdminWorkspacesPane() {
  const { t, locale } = useI18n()
  const copy = t.superAdmin.workspaces
  const query = useQuery(adminWorkspacesQuery())
  const [dialog, setDialog] = useState<{ action: 'details' | 'delete'; workspace: AdminWorkspace } | null>(null)
  const [notice, setNotice] = useState<Notice>()
  const workspaces = query.data

  if (!workspaces) {
    return (
      <SettingsPage>
        <SettingsHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingNotice notice={notice} />
      <SettingsTableSection>
        <DataTable
          columns={superAdminWorkspaceColumns({
            t,
            locale,
            onDelete: (workspace) => {
              setNotice(undefined)
              setDialog({ action: 'delete', workspace })
            },
          })}
          data={workspaces}
          search={{ label: copy.searchLabel, placeholder: copy.searchPlaceholder }}
          filters={[
            {
              columnId: 'health',
              label: copy.filterByHealth,
              allOption: { value: 'all', label: copy.allHealthStates },
              options: adminWorkspaceHealthOptions(t),
              className: 'w-48',
            },
          ]}
          initialSorting={[{ id: 'createdAt', desc: true }]}
          sortingStorageKey="stlquest:super-admin-workspaces:sorting"
          columnVisibility={{
            storageKey: 'stlquest:super-admin-workspaces:columns',
            initial: { createdAt: false, copyCount: false, printerCount: false, lastRequestAt: false },
            labels: {
              owners: t.superAdmin.columns.owner,
              memberCount: t.superAdmin.columns.members,
              requestCount: t.superAdmin.columns.requests,
              copyCount: t.superAdmin.columns.copies,
              printerCount: t.superAdmin.columns.printers,
              createdAt: t.superAdmin.columns.created,
              lastRequestAt: t.superAdmin.columns.lastRequestChange,
              storage: t.superAdmin.columns.storage,
              health: t.superAdmin.columns.health,
            },
          }}
          emptyMessage={copy.empty}
          itemLabel={{ singular: copy.itemSingular, plural: copy.itemPlural }}
          alignLastColumnRight
          onRowClick={(workspace) => {
            setNotice(undefined)
            setDialog({ action: 'details', workspace })
          }}
          getRowLabel={(workspace) => t.superAdmin.viewDetails(workspace.name)}
        />
      </SettingsTableSection>
      {dialog?.action === 'details' && <SuperAdminWorkspaceDialog workspace={dialog.workspace} onDone={() => setDialog(null)} />}
      {dialog?.action === 'delete' && (
        <DeleteWorkspaceDialog
          workspace={dialog.workspace}
          onDone={() => setDialog(null)}
          onDeleted={(workspace) =>
            setNotice({
              tone: 'success',
              title: copy.deletedTitle(workspace.name),
              hint: copy.deletedHint,
            })
          }
        />
      )}
    </SettingsPage>
  )
}
