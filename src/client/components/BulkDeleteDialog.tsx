import type { PublicPrintRequest } from '../../core/types'
import { ConfirmDialog } from './ConfirmDialog'

export function BulkDeleteDialog({
  requests,
  total,
  onConfirm,
  onCancel,
}: {
  requests: PublicPrintRequest[]
  total: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmDialog
      open
      title={`Delete ${requests.length} selected requests?`}
      description={`This permanently deletes ${total} affected instances and their files.`}
      confirmLabel="Delete requests"
      destructive
      size="lg"
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={
        <ul className="max-h-[50dvh] space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
          {requests.map((request) => (
            <li key={request.id} className="truncate">
              {request.name}
            </li>
          ))}
        </ul>
      }
    />
  )
}
