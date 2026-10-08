import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@/components/ui/data-table'
import type { AdminWorkspace } from '../../../core/admin'
import { adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsTableSection } from './SettingsLayout'
import { DeleteWorkspaceDialog } from './SuperAdminDeleteWorkspaceDialog'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'
import { adminWorkspaceHealthOptions, superAdminWorkspaceColumns } from './SuperAdminWorkspacesTable'

export function SuperAdminWorkspacesPane() {
  const query = useQuery(adminWorkspacesQuery())
  const [dialog, setDialog] = useState<{ action: 'details' | 'delete'; workspace: AdminWorkspace } | null>(null)
  const [notice, setNotice] = useState<Notice>()
  const workspaces = query.data

  if (!workspaces) {
    return (
      <SettingsPage>
        <SettingsHeader title="Workspaces" description="Inspect workspace ownership, usage, storage, and processing health." />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading workspaces…"
          errorTitle="Could not load workspaces"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Workspaces" description="Inspect workspace ownership, usage, storage, and processing health." />
      <SettingNotice notice={notice} />
      <SettingsTableSection>
        <DataTable
          columns={superAdminWorkspaceColumns({
            onDelete: (workspace) => {
              setNotice(undefined)
              setDialog({ action: 'delete', workspace })
            },
          })}
          data={workspaces}
          search={{ label: 'Search workspaces', placeholder: 'Search workspaces…' }}
          filters={[
            {
              columnId: 'health',
              label: 'Filter workspaces by health',
              allOption: { value: 'all', label: 'All health states' },
              options: adminWorkspaceHealthOptions,
              className: 'w-48',
            },
          ]}
          initialSorting={[{ id: 'createdAt', desc: true }]}
          sortingStorageKey="stlquest:super-admin-workspaces:sorting"
          columnVisibility={{
            storageKey: 'stlquest:super-admin-workspaces:columns',
            initial: { createdAt: false, copyCount: false, printerCount: false, lastRequestAt: false },
            labels: {
              owners: 'Owner',
              memberCount: 'Members',
              requestCount: 'Requests',
              copyCount: 'Copies',
              printerCount: 'Printers',
              createdAt: 'Created',
              lastRequestAt: 'Last request change',
              storage: 'Storage',
              health: 'Health',
            },
          }}
          emptyMessage="No workspaces match these filters."
          itemLabel={{ singular: 'workspace', plural: 'workspaces' }}
          alignLastColumnRight
          onRowClick={(workspace) => {
            setNotice(undefined)
            setDialog({ action: 'details', workspace })
          }}
          getRowLabel={(workspace) => `View details for ${workspace.name}`}
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
              title: `${workspace.name} was deleted`,
              hint: 'Its print requests, models, settings, and invitations are gone.',
            })
          }
        />
      )}
    </SettingsPage>
  )
}
