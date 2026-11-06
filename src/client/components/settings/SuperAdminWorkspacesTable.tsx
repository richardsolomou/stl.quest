import { useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Ellipsis, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DataTableFeatures } from '@/components/ui/data-table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatBytes } from '../../../core/format'
import { adminWorkspaceHealth, type AdminWorkspace } from '../../../core/admin'
import type { Locale, Messages } from '../../../core/i18n'

const columnHelper = createColumnHelper<DataTableFeatures, AdminWorkspace>()
const secondaryColumn = { className: '@max-3xl:hidden' }

export const adminWorkspaceHealthOptions = (t: Messages) =>
  (['attention', 'healthy'] as const).map((value) => ({ value, label: t.superAdmin.health[value] }))

export function superAdminWorkspaceColumns({
  t,
  locale,
  onDelete,
}: {
  t: Messages
  locale: Locale
  onDelete: (workspace: AdminWorkspace) => void
}) {
  const copy = t.superAdmin
  return columnHelper.columns([
    columnHelper.accessor('name', {
      header: copy.columns.workspace,
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
      header: copy.columns.owner,
      cell: ({ getValue }) => {
        const owners = getValue()
        return owners ? (
          <span className="block max-w-36 truncate" title={owners}>
            {owners}
          </span>
        ) : (
          <span className="text-muted-foreground">{copy.workspaces.none}</span>
        )
      },
      meta: { className: '@max-xl:hidden' },
    }),
    columnHelper.accessor('memberCount', { header: copy.columns.members, meta: secondaryColumn }),
    columnHelper.accessor('requestCount', { header: copy.columns.requests, meta: secondaryColumn }),
    columnHelper.accessor('copyCount', { header: copy.columns.copies, meta: secondaryColumn }),
    columnHelper.accessor('printerCount', { header: copy.columns.printers, meta: secondaryColumn }),
    columnHelper.accessor('createdAt', {
      header: copy.columns.created,
      cell: ({ getValue }) => <DateCell value={getValue()} locale={locale} />,
      meta: secondaryColumn,
    }),
    columnHelper.accessor('lastRequestAt', {
      header: copy.columns.lastRequestChange,
      cell: ({ getValue }) => {
        const value = getValue()
        return value ? <DateCell value={value} locale={locale} /> : <span className="text-muted-foreground">{copy.noRequests}</span>
      },
      sortUndefined: 'last',
      meta: secondaryColumn,
    }),
    columnHelper.display({
      id: 'storage',
      header: copy.columns.storage,
      cell: ({ row }) => {
        const workspace = row.original
        if (!workspace.storageConfigured) return <span className="text-muted-foreground">{copy.notConfigured}</span>
        if (!workspace.managedStorage) return copy.configured
        return (
          <span className="whitespace-nowrap">
            {formatBytes(workspace.managedStorage.usedBytes, locale)} · {workspace.managedStorage.plan}
          </span>
        )
      },
      meta: secondaryColumn,
    }),
    columnHelper.accessor(adminWorkspaceHealth, {
      id: 'health',
      header: copy.columns.health,
      cell: ({ getValue }) =>
        getValue() === 'attention' ? (
          <Badge variant="destructive">{copy.health.attention}</Badge>
        ) : (
          <Badge variant="outline">{copy.health.healthy}</Badge>
        ),
      meta: { className: '@max-sm:hidden' },
    }),
    columnHelper.display({
      id: 'actions',
      enableHiding: false,
      header: copy.columns.actions,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <WorkspaceActions t={t} workspace={row.original} onDelete={onDelete} />
        </div>
      ),
    }),
  ])
}

function WorkspaceActions({
  t,
  workspace,
  onDelete,
}: {
  t: Messages
  workspace: AdminWorkspace
  onDelete: (workspace: AdminWorkspace) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ph-no-capture"
            aria-label={t.superAdmin.actionsFor(workspace.name)}
          />
        }
      >
        <Ellipsis />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 gap-0.5 p-1">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start text-destructive hover:text-destructive"
          onClick={() => {
            setOpen(false)
            onDelete(workspace)
          }}
        >
          <Trash2 />
          {t.superAdmin.workspaces.delete}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function DateCell({ value, locale }: { value: number; locale: Locale }) {
  return <time dateTime={new Date(value).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(value)}</time>
}
