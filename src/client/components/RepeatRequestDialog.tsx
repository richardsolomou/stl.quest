import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MAX_REQUEST_QUANTITY, MIN_REQUEST_QUANTITY, normalizeRequestQuantity } from '../../core/request'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'

export function RepeatRequestDialog({
  requestName,
  quantity,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  requestName: string
  quantity: number
  pending: boolean
  error?: string
  onConfirm: (quantity: number) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(String(quantity))

  return (
    <DialogShell onClose={onCancel} title="Print again" className="sm:max-w-[360px]" preventClose={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm(normalizeRequestQuantity(value))
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          Create a new request for “{requestName}”. The existing request and its progress will not change.
        </p>
        <Field>
          <FieldLabel htmlFor="repeat-request-quantity">Copies</FieldLabel>
          <Input
            id="repeat-request-quantity"
            type="number"
            inputMode="numeric"
            min={MIN_REQUEST_QUANTITY}
            max={MAX_REQUEST_QUANTITY}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        <DialogProblem title="The request was not created" hint="The existing request was not changed. Try again." error={error} />
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create request'}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
