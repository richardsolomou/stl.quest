import type { PublicPrintRequest } from '../../core/types'
import { BulkRequestRow } from './BulkRequestRow'
import { ConfirmDialog } from './ConfirmDialog'

export function BulkDeleteDialog({
  entries,
  pending = false,
  title,
  confirmLabel,
  error,
  onConfirm,
  onCancel,
}: {
  entries: { request: PublicPrintRequest; count: number }[]
  pending?: boolean
  title?: string
  confirmLabel?: string
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <ConfirmDialog
      open
      title={title ?? `Delete ${entries.length} selected card${entries.length === 1 ? '' : 's'}?`}
      description={`This removes ${total} instance${total === 1 ? '' : 's'} from the board and cannot be undone. Once a print has no copies left anywhere, its uploaded model file is deleted from storage too.`}
      confirmLabel={confirmLabel ?? `Delete ${total === 1 ? 'copy' : 'copies'}`}
      destructive
      size="lg"
      pending={pending}
      problem={
        error ? { title: 'Nothing was deleted', hint: 'The board is unchanged. Check your connection and try again.', error } : undefined
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {entries.map(({ request, count }) => (
            <BulkRequestRow key={request.id} request={request} detail={`${count} ${count === 1 ? 'instance' : 'instances'}`} />
          ))}
        </div>
      }
    />
  )
}
