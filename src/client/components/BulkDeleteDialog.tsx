import type { PublicPrintRequest } from '../../core/types'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyThumb } from './LazyThumb'

export function BulkDeleteDialog({
  entries,
  pending = false,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  entries: { request: PublicPrintRequest; count: number }[]
  pending?: boolean
  title?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <ConfirmDialog
      open
      title={title ?? `Delete ${entries.length} selected card${entries.length === 1 ? '' : 's'}?`}
      description={`This permanently deletes ${total} affected instance${total === 1 ? '' : 's'}. Associated files are removed when no copies remain.`}
      confirmLabel={confirmLabel ?? `Delete ${total === 1 ? 'copy' : 'copies'}`}
      destructive
      size="lg"
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={
        <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {entries.map(({ request, count }) => (
            <li key={request.id} className="flex items-center gap-3 rounded-lg border bg-secondary/40 p-2.5">
              {request.hasThumbnail ? (
                <LazyThumb requestId={request.id} />
              ) : (
                <div className="grid size-16 shrink-0 place-items-center rounded-md border bg-background font-mono text-[10px] text-muted-foreground">
                  stl
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{request.name}</div>
                <div className="text-xs text-muted-foreground">
                  {count} {count === 1 ? 'instance' : 'instances'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      }
    />
  )
}
