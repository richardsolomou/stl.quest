import type { PublicPrintRequest } from '../../core/types'
import { BulkRequestRow } from './BulkRequestRow'
import { ConfirmDialog } from './ConfirmDialog'
import { useI18n } from '../i18n'

export function BulkDeleteDialog({
  entries,
  pending = false,
  title,
  confirmLabel,
  error,
  onConfirm,
  onCancel,
}: {
  /** One row per card; `key` tells apart cards of the same print. */
  entries: { key?: string; request: PublicPrintRequest; count: number }[]
  pending?: boolean
  title?: string
  confirmLabel?: string
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const d = t.board.bulkDelete
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <ConfirmDialog
      open
      title={title ?? d.title(entries.length)}
      description={d.description(total)}
      confirmLabel={confirmLabel ?? d.confirm(total)}
      destructive
      size="lg"
      pending={pending}
      problem={error ? { title: d.problemTitle, hint: d.problemHint, error } : undefined}
      onConfirm={onConfirm}
      onCancel={onCancel}
      details={
        <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
          {entries.map(({ key, request, count }) => (
            <BulkRequestRow key={key ?? request.id} request={request} detail={d.instances(count)} />
          ))}
        </div>
      }
    />
  )
}
