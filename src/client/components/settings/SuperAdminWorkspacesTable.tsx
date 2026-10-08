import { createColumnHelper } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import type { DataTableFeatures } from '@/components/ui/data-table'
import { formatBytes } from '../../../core/format'
import { adminWorkspaceHealth, type AdminWorkspace } from '../../../core/admin'

const columnHelper = createColumnHelper<DataTableFeatures, AdminWorkspace>()
const secondaryColumn = { className: '@max-3xl:hidden' }

export const adminWorkspaceHealthOptions = [
  { value: 'attention', label: 'Needs attention' },
  { value: 'healthy', label: 'Healthy' },
] as const

export const superAdminWorkspaceColumns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Workspace',
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium" title={row.original.name}>
          {row.original.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{row.original.slug}</p>
      </div>
    ),
    enableHiding: false,
  }),
  columnHelper.accessor((workspace) => workspace.owners.map((owner) => owner.name).join(', '), {
    id: 'owners',
    header: 'Owner',
    cell: ({ getValue }) => {
      const owners = getValue()
      return owners ? (
        <span className="block max-w-36 truncate" title={owners}>
          {owners}
        </span>
      ) : (
        <span className="text-muted-foreground">None</span>
      )
    },
    meta: { className: '@max-xl:hidden' },
  }),
  columnHelper.accessor('memberCount', { header: 'Members', meta: secondaryColumn }),
  columnHelper.accessor('requestCount', { header: 'Requests', meta: secondaryColumn }),
  columnHelper.accessor('copyCount', { header: 'Copies', meta: secondaryColumn }),
  columnHelper.accessor('printerCount', { header: 'Printers', meta: secondaryColumn }),
  columnHelper.accessor('createdAt', { header: 'Created', cell: ({ getValue }) => <DateCell value={getValue()} />, meta: secondaryColumn }),
  columnHelper.accessor('lastRequestAt', {
    header: 'Last request change',
    cell: ({ getValue }) => {
      const value = getValue()
      return value ? <DateCell value={value} /> : <span className="text-muted-foreground">No requests</span>
    },
    sortUndefined: 'last',
    meta: secondaryColumn,
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
    meta: secondaryColumn,
  }),
  columnHelper.accessor(adminWorkspaceHealth, {
    id: 'health',
    header: 'Health',
    cell: ({ getValue }) =>
      getValue() === 'attention' ? (
        <Badge variant="destructive">
          <span className="@max-sm:hidden">Needs attention</span>
          <span className="@sm:hidden">Attention</span>
        </Badge>
      ) : (
        <Badge variant="outline">Healthy</Badge>
      ),
  }),
])

function DateCell({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)}</time>
}
