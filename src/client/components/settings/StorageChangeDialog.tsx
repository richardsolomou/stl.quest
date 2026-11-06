import { Check } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import type { StorageConfig, StorageInventory } from '../../../core/types'
import { formatBytes } from '../../../core/format'
import { storageLabel } from '../../storageProviders'
import { useI18n } from '../../i18n'

export type DestinationAction = 'preserve' | 'clear-all'

export function StorageChangeDialog({
  change,
  current,
  action,
  acknowledged,
  migrationWillRun,
  onAction,
  onAcknowledge,
  onConfirm,
  onCancel,
}: {
  change?: { config: StorageConfig; inventory: StorageInventory }
  current: StorageConfig
  action: DestinationAction
  acknowledged: boolean
  migrationWillRun: boolean
  onAction: (action: DestinationAction) => void
  onAcknowledge: (acknowledged: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t: messages, locale } = useI18n()
  const t = messages.storage.change
  const inventory = change?.inventory
  const occupied = !!inventory && (inventory.files > 0 || inventory.folders > 0)
  const kind = change?.config.adapter === 's3' ? 'bucket' : 'folder'
  const deleting = occupied && action === 'clear-all'
  return (
    <AlertDialog
      open={!!change}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <AlertDialogContent size="lg" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{occupied ? t.notEmptyTitle(kind) : t.moveTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {occupied && inventory
              ? t.occupiedDescription(inventory.files, inventory.folders, formatBytes(inventory.bytes, locale))
              : t.moveDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {change && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <span className="text-muted-foreground">{t.from}</span>
                <code className="truncate" title={storageLabel(current, messages.storage)}>
                  {storageLabel(current, messages.storage)}
                </code>
                <span className="text-muted-foreground">{t.to}</span>
                <code className="truncate" title={storageLabel(change.config, messages.storage)}>
                  {storageLabel(change.config, messages.storage)}
                </code>
              </div>
            </div>
            {occupied && inventory && (
              <>
                {inventory.entries.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{t.seeContents}</summary>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t pt-2 font-mono text-xs">
                      {inventory.entries.map((entry) => (
                        <li key={`${entry.type}:${entry.path}`} className="flex justify-between gap-3">
                          <span className="min-w-0 break-all">{entry.type === 'folder' ? `${entry.path}/` : entry.path}</span>
                          {entry.bytes !== undefined && (
                            <span className="shrink-0 text-muted-foreground">{formatBytes(entry.bytes, locale)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {inventory.truncated && <p className="mt-2 text-xs text-muted-foreground">{t.truncated}</p>}
                  </details>
                )}
                <div className="flex flex-col gap-2">
                  <DestinationChoice
                    selected={action === 'preserve'}
                    title={t.preserveTitle}
                    description={t.preserveDescription(kind)}
                    onSelect={() => onAction('preserve')}
                  />
                  <DestinationChoice
                    selected={action === 'clear-all'}
                    destructive
                    title={t.clearTitle}
                    description={t.clearDescription(inventory.files, inventory.folders, formatBytes(inventory.bytes, locale))}
                    onSelect={() => onAction('clear-all')}
                  />
                </div>
              </>
            )}
            {deleting && (
              <Field orientation="horizontal" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <Checkbox id="storage-clear-acknowledged" checked={acknowledged} onCheckedChange={onAcknowledge} />
                <FieldLabel htmlFor="storage-clear-acknowledged" className="text-sm font-normal">
                  {t.acknowledge(kind)}
                </FieldLabel>
              </Field>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">{migrationWillRun ? t.migrationNote : t.immediateNote}</p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{messages.common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant={deleting ? 'destructive' : 'default'} disabled={deleting && !acknowledged} onClick={onConfirm}>
            {deleting ? t.deleteAndSwitch : migrationWillRun ? t.copyAndSwitch : t.startUsing}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DestinationChoice({
  selected,
  destructive = false,
  title,
  description,
  onSelect,
}: {
  selected: boolean
  destructive?: boolean
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        selected && !destructive && 'border-primary/50 bg-primary/5',
        selected && destructive && 'border-destructive/50 bg-destructive/5',
        !selected && 'hover:bg-muted/60',
      )}
      onClick={onSelect}
    >
      <span
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
          selected && (destructive ? 'border-destructive bg-destructive text-white' : 'border-primary bg-primary text-primary-foreground'),
        )}
      >
        {selected && <Check className="size-3" aria-hidden="true" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block font-medium', selected && destructive && 'text-destructive')}>{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
