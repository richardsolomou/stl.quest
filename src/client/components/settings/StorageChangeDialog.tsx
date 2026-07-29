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
  const inventory = change?.inventory
  const occupied = !!inventory && (inventory.files > 0 || inventory.folders > 0)
  const destination = change ? storageName(change.config) : 'the new location'
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
          <AlertDialogTitle>{occupied ? `That ${destination} is not empty` : 'Move your files to the new location?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {occupied && inventory
              ? `${countLabel(inventory)} already sit there. Choose what happens to them before STL Quest starts using it.`
              : 'STL Quest copies and verifies every file into the new location before it goes live.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {change && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <span className="text-muted-foreground">From</span>
                <code className="truncate" title={storageLabel(current)}>
                  {storageLabel(current)}
                </code>
                <span className="text-muted-foreground">To</span>
                <code className="truncate" title={storageLabel(change.config)}>
                  {storageLabel(change.config)}
                </code>
              </div>
            </div>
            {occupied && inventory && (
              <>
                {inventory.entries.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">See what is already there</summary>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t pt-2 font-mono text-xs">
                      {inventory.entries.map((entry) => (
                        <li key={`${entry.type}:${entry.path}`} className="flex justify-between gap-3">
                          <span className="min-w-0 break-all">{entry.type === 'folder' ? `${entry.path}/` : entry.path}</span>
                          {entry.bytes !== undefined && <span className="shrink-0 text-muted-foreground">{formatBytes(entry.bytes)}</span>}
                        </li>
                      ))}
                    </ul>
                    {inventory.truncated && <p className="mt-2 text-xs text-muted-foreground">Showing the first 100 items.</p>}
                  </details>
                )}
                <div className="flex flex-col gap-2">
                  <DestinationChoice
                    selected={action === 'preserve'}
                    title="Leave them alone"
                    description={`STL Quest adds its own workspace folder next to what is already in the ${destination}. Nothing existing is read, moved, or deleted.`}
                    onSelect={() => onAction('preserve')}
                  />
                  <DestinationChoice
                    selected={action === 'clear-all'}
                    destructive
                    title="Delete everything there first"
                    description={`Permanently removes ${countLabel(inventory)}, including files belonging to other STL Quest workspaces. This cannot be undone.`}
                    onSelect={() => onAction('clear-all')}
                  />
                </div>
              </>
            )}
            {deleting && (
              <Field orientation="horizontal" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <Checkbox id="storage-clear-acknowledged" checked={acknowledged} onCheckedChange={onAcknowledge} />
                <FieldLabel htmlFor="storage-clear-acknowledged" className="text-sm font-normal">
                  I understand everything currently in that {destination} is deleted for good.
                </FieldLabel>
              </Field>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {migrationWillRun
                ? 'Your current storage keeps serving the board until copying and verification finish, so nothing is lost if the move fails.'
                : 'The new location starts being used as soon as you confirm.'}
            </p>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={deleting ? 'destructive' : 'default'} disabled={deleting && !acknowledged} onClick={onConfirm}>
            {deleting ? 'Delete and switch' : migrationWillRun ? 'Copy files and switch' : 'Start using it'}
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

function countLabel({ files, folders, bytes }: StorageInventory) {
  const parts = [plural(files, 'file'), ...(folders ? [plural(folders, 'folder')] : [])]
  return `${parts.join(' and ')} (${formatBytes(bytes)})`
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function storageName(config: StorageConfig) {
  return config.adapter === 's3' ? 'bucket' : 'folder'
}
