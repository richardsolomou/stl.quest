import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DialogShell } from './DialogShell'

type MoveDestination = { id: string; label: string }

export function MoveDialog({
  requestName,
  toLabel,
  destinations,
  max,
  onConfirm,
  onCancel,
}: {
  requestName: string
  toLabel?: string
  destinations?: MoveDestination[]
  max: number
  onConfirm: (count: number, destination?: string) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(String(max))
  const [destination, setDestination] = useState(destinations?.[0]?.id ?? '')

  return (
    <DialogShell onClose={onCancel} title="Move copies" className="sm:max-w-[360px]">
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
          <Field className="mb-3">
            <FieldLabel htmlFor="move-destination">Destination</FieldLabel>
            <Select value={destination} onValueChange={(value) => setDestination(value ?? '')}>
              <SelectTrigger id="move-destination" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
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
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Move</Button>
        </div>
      </form>
    </DialogShell>
  )
}
