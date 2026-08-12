import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DataTable } from '@/components/ui/data-table'
import type { AdminWorkspace } from '../../../core/admin'
import { adminWorkspacesQuery } from '../../queries'
import { QueryState } from '../QueryState'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SuperAdminWorkspaceDialog } from './SuperAdminWorkspaceDialog'
import { adminWorkspaceHealthOptions, superAdminWorkspaceColumns } from './SuperAdminWorkspacesTable'

export function SuperAdminWorkspacesPane() {
  const query = useQuery(adminWorkspacesQuery())
  const [selected, setSelected] = useState<AdminWorkspace>()
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
      <SettingsSection className="p-0 max-sm:[&_td]:px-1.5 max-sm:[&_th]:px-1.5">
        <DataTable
          columns={superAdminWorkspaceColumns}
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
            initial: { createdAt: false, copyCount: false, printerCount: false },
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
          onRowClick={setSelected}
          getRowLabel={(workspace) => `View details for ${workspace.name}`}
        />
      </SettingsSection>
      {selected && <SuperAdminWorkspaceDialog workspace={selected} onDone={() => setSelected(undefined)} />}
    </SettingsPage>
  )
}
