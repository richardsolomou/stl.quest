import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { errorMessage } from '../../../core/error'
import type { InventoryKind } from '../../../core/inventory'
import { referenceCount, type InventoryReferences } from '../../../core/inventoryDeletion'
import { useI18n } from '../../i18n'
import { inventoryReferencesQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingsSection } from './SettingsLayout'

type ArchivedRow = { id: string; name: string; detail: string }

/** The Archived section at the foot of an inventory page: each item restores, or is deleted for good after a confirmation. */
export function ArchivedInventory({
  kind,
  title,
  description,
  restoreLabel,
  items,
  pending,
  onRestore,
  onDelete,
}: {
  kind: InventoryKind
  title: string
  description: string
  restoreLabel: string
  items: ArchivedRow[]
  pending: boolean
  onRestore: (id: string) => void
  onDelete: (id: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [deleting, setDeleting] = useState<ArchivedRow>()
  if (!items.length) return null
  return (
    <SettingsSection layout="stacked" title={title} description={description}>
      <div className="@container overflow-hidden rounded-lg border">
        <Table>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="w-full max-w-0">
                  <span className="block truncate font-medium" title={item.name}>
                    {item.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onRestore(item.id)}>
                    <RotateCcw />
                    <span className="@max-sm:sr-only">{restoreLabel}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                    aria-label={`${t.common.delete} ${item.name}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 />
                    <span className="@max-sm:sr-only">{t.common.delete}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {deleting && (
        <DeleteInventoryDialog key={deleting.id} kind={kind} item={deleting} onDelete={onDelete} onClose={() => setDeleting(undefined)} />
      )}
    </SettingsSection>
  )
}

function DeleteInventoryDialog({
  kind,
  item,
  onDelete,
  onClose,
}: {
  kind: InventoryKind
  item: ArchivedRow
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.inventoryDelete
  const references = useQuery(inventoryReferencesQuery(useWorkspaceSlug(), kind, item.id))
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string>()
  const confirm = () => {
    setPending(true)
    setFailure(undefined)
    onDelete(item.id).then(
      () => {
        toast(copy.deleted(item.name))
        onClose()
      },
      (error: unknown) => {
        setPending(false)
        setFailure(errorMessage(error, t.shell.confirm.noDetail))
      },
    )
  }
  return (
    <ConfirmDialog
      open
      destructive
      title={copy.title(item.name)}
      description={copy.description}
      details={<ReferenceSummary references={references.data} loading={references.isPending} failed={references.isError} />}
      confirmLabel={t.common.delete}
      pendingLabel={copy.pending}
      pending={pending}
      confirmDisabled={references.isPending}
      problem={failure === undefined ? undefined : { title: copy.failed, hint: copy.failedHint, error: failure }}
      onConfirm={confirm}
      onCancel={onClose}
    />
  )
}

const REFERENCE_ORDER = ['requests', 'plates', 'usage', 'stock', 'supplies', 'parts'] as const satisfies (keyof InventoryReferences)[]

function ReferenceSummary({ references, loading, failed }: { references?: InventoryReferences; loading: boolean; failed: boolean }) {
  const copy = useI18n().t.settings.inventoryDelete
  if (loading)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {copy.counting}
      </p>
    )
  if (failed || !references) return <p className="text-sm text-muted-foreground">{copy.countFailed}</p>
  if (!referenceCount(references)) return <p className="text-sm text-muted-foreground">{copy.unused}</p>
  return (
    <div className="text-sm" data-testid="inventory-references">
      <p className="font-medium">{copy.used}</p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {REFERENCE_ORDER.filter((key) => references[key] > 0).map((key) => (
          <li key={key}>{copy[key](references[key])}</li>
        ))}
      </ul>
    </div>
  )
}
