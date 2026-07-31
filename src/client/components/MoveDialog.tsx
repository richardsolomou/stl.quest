import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { DialogShell } from './DialogShell'
import { DialogProblem } from './DialogProblem'
import { MoveDestinationField, type MoveDestination } from './MoveDestinationField'

export function MoveDialog({
  requestName,
  toLabel,
  destinations,
  max,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  requestName: string
  toLabel?: string
  destinations?: MoveDestination[]
  max: number
  pending?: boolean
  error?: string
  onConfirm: (count: number, destination?: string) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(String(max))
  const [destination, setDestination] = useState(destinations?.[0]?.id ?? '')

  return (
    <DialogShell onClose={onCancel} title="Move copies" className="sm:max-w-[360px]" preventClose={pending}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(Math.min(max, Math.max(1, Math.round(Number(count) || 1))), destination || undefined)
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          {toLabel ? `How many copies of “${requestName}” to ${toLabel}?` : `Move copies of “${requestName}” to another stage.`}
        </p>
        {destinations && (
          <MoveDestinationField id="move-destination" value={destination} destinations={destinations} onChange={setDestination} />
        )}
        <Field>
          <FieldLabel htmlFor="move-count">Copies (of {max})</FieldLabel>
          <Input
            id="move-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
        <DialogProblem title="The print was not moved" hint="It is still in the queue. Try again." error={error} />
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Moving…' : 'Move'}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
