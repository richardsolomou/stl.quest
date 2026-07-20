import type { PublicPrintRequest } from '../../core/types'
import { ConfirmDialog } from './ConfirmDialog'
import { LazyThumb } from './LazyThumb'

export function BulkDeleteDialog({
  requests,
  onConfirm,
  onCancel,
}: {
  requests: PublicPrintRequest[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const total = requests.reduce((sum, request) => sum + request.quantity, 0)

  return (
    <ConfirmDialog
      open
      title={`Delete ${requests.length} selected request${requests.length === 1 ? '' : 's'}?`}
      description={`This permanently deletes ${total} affected instance${total === 1 ? '' : 's'} and all associated files.`}
      confirmLabel={`Delete ${requests.length === 1 ? 'request' : 'requests'}`}
      destructive
      size="lg"
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={
        <ul className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {requests.map((request) => (
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
                  {request.quantity} {request.quantity === 1 ? 'instance' : 'instances'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      }
    />
  )
}
