import { createColumnHelper, type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '../../../core/format'
import { adminWorkspaceHealth, type AdminWorkspace } from '../../../core/admin'

const columnHelper = createColumnHelper<AdminWorkspace>()

export const adminWorkspaceHealthOptions = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'healthy', label: 'Healthy' },
] as const

export const superAdminWorkspaceColumns: ColumnDef<AdminWorkspace>[] = [
  columnHelper.accessor('name', {
    header: 'Workspace',
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.original.name}</p>
        <p className="truncate text-xs text-muted-foreground">{row.original.slug}</p>
      </div>
    ),
    enableHiding: false,
  }),
  columnHelper.accessor((workspace) => workspace.owners.map((owner) => owner.name).join(', '), {
    id: 'owners',
    header: 'Owner',
    cell: ({ getValue }) => getValue() || <span className="text-muted-foreground">None</span>,
  }),
  columnHelper.accessor('memberCount', { header: 'Members' }),
  columnHelper.accessor('requestCount', { header: 'Requests' }),
  columnHelper.accessor('copyCount', { header: 'Copies' }),
  columnHelper.accessor('printerCount', { header: 'Printers' }),
  columnHelper.accessor('createdAt', { header: 'Created', cell: ({ getValue }) => <DateCell value={getValue()} /> }),
  columnHelper.accessor('lastRequestAt', {
    header: 'Last request change',
    cell: ({ getValue }) => (getValue() ? <DateCell value={getValue()!} /> : <span className="text-muted-foreground">No requests</span>),
    sortUndefined: 'last',
  }),
  columnHelper.display({
    id: 'storage',
    header: 'Storage',
    cell: ({ row }) => {
      const workspace = row.original
      if (!workspace.storageConfigured) return <span className="text-muted-foreground">Not configured</span>
      if (!workspace.managedStorage) return 'Configured'
      return (
        <span className="whitespace-nowrap">
          {formatBytes(workspace.managedStorage.usedBytes)} · {workspace.managedStorage.plan}
        </span>
      )
    },
  }),
  columnHelper.accessor(adminWorkspaceHealth, {
    id: 'health',
    header: 'Health',
    cell: ({ getValue }) =>
      getValue() === 'attention' ? <Badge variant="destructive">Needs attention</Badge> : <Badge variant="outline">Healthy</Badge>,
  }),
]

function DateCell({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)}</time>
}
