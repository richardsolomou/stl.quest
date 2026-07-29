import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { PublicPrintRequest } from '../../core/types'
import type { StatusId } from '../../core/workflow'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { LazyThumb } from './LazyThumb'
import { MoveDestinationField, type MoveDestination } from './MoveDestinationField'

type Entry = { request: PublicPrintRequest; max: number }

export function BulkMoveDialog({
  entries,
  requestCount,
  destination,
  destinations,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  entries: Entry[]
  requestCount: number
  destination?: StatusId
  destinations?: MoveDestination[]
  pending: boolean
  error?: string
  onConfirm: (counts: Record<string, number>, destination: StatusId) => void
  onCancel: () => void
}) {
  const [counts, setCounts] = useState(() => Object.fromEntries(entries.map(({ request, max }) => [request.id, String(max)])))
  const [selectedDestination, setSelectedDestination] = useState(destination ?? destinations?.[0]?.id ?? '')
  const invalid = useMemo(
    () =>
      entries.some(({ request, max }) => {
        const count = Number(counts[request.id])
        return !Number.isInteger(count) || count < 1 || count > max
      }),
    [counts, entries],
  )

  return (
    <DialogShell
      onClose={onCancel}
      title={`Move ${requestCount} selected request${requestCount === 1 ? '' : 's'}`}
      className="sm:max-w-[620px]"
      preventClose={pending}
    >
      <form
        className="flex min-h-full flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          if (!selectedDestination || invalid) return
          onConfirm(Object.fromEntries(entries.map(({ request }) => [request.id, Number(counts[request.id])])), selectedDestination)
        }}
      >
        {destinations && (
          <MoveDestinationField
            id="batch-move-destination"
            value={selectedDestination}
            destinations={destinations}
            onChange={setSelectedDestination}
          />
        )}
        <div className="space-y-2">
          {entries.map(({ request, max }) => (
            <div key={request.id} className="flex items-center gap-3 rounded-lg border bg-secondary/40 p-2.5">
              {request.hasThumbnail ? (
                <LazyThumb requestId={request.id} />
              ) : (
                <div className="grid size-16 shrink-0 place-items-center rounded-md border bg-background font-mono text-[10px] text-muted-foreground">
                  stl
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{request.name}</div>
                <div className="text-xs text-muted-foreground">Quantity here: {max}</div>
              </div>
              <Field className="w-24 shrink-0">
                <FieldLabel htmlFor={`batch-move-${request.id}`} className="sr-only">
                  Instances of {request.name} to move
                </FieldLabel>
                <Input
                  id={`batch-move-${request.id}`}
                  aria-label={`Instances of ${request.name} to move`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max}
                  value={counts[request.id]}
                  onChange={(event) => setCounts((current) => ({ ...current, [request.id]: event.target.value }))}
                />
              </Field>
            </div>
          ))}
        </div>
        <DialogProblem title="Nothing was moved" hint="The prints are still in their current stage. Try again." error={error} />
        <div className="sticky bottom-0 mt-auto flex justify-end gap-2 bg-popover pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={pending || !selectedDestination}
            onClick={() => onConfirm(Object.fromEntries(entries.map(({ request, max }) => [request.id, max])), selectedDestination)}
          >
            Move all
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || invalid || !selectedDestination}>
            {pending ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
