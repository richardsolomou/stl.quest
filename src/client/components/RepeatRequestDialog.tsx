import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { MAX_REQUEST_QUANTITY, MIN_REQUEST_QUANTITY, normalizeRequestQuantity } from '../../core/request'
import { DialogProblem } from './DialogProblem'
import { DialogShell } from './DialogShell'
import { useI18n } from '../i18n'

export function RepeatRequestDialog({
  requestNames,
  quantity,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  requestNames: string[]
  quantity: number
  pending: boolean
  error?: string
  onConfirm: (quantity: number) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(String(quantity))

  return (
    <DialogShell onClose={onCancel} title={t.requests.repeat.title} className="sm:max-w-[360px]" preventClose={pending}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm(normalizeRequestQuantity(value))
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          {requestNames.length === 1
            ? t.requests.repeat.descriptionSingle(requestNames[0])
            : t.requests.repeat.descriptionMultiple(requestNames.length)}
        </p>
        <Field>
          <FieldLabel htmlFor="repeat-request-quantity">{t.requests.fields.copies}</FieldLabel>
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
        <DialogProblem
          title={requestNames.length === 1 ? t.requests.repeat.failedSingleTitle : t.requests.repeat.failedMultipleTitle}
          hint={requestNames.length === 1 ? t.requests.repeat.failedSingleHint : t.requests.repeat.failedMultipleHint}
          error={error}
        />
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            {pending ? t.requests.repeat.creating : t.requests.repeat.create(requestNames.length)}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
