import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { DialogShell } from './DialogShell'
import { DialogProblem } from './DialogProblem'
import { MoveDestinationField, type MoveDestination } from './MoveDestinationField'
import { useI18n } from '../i18n'

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
  const { t } = useI18n()
  const m = t.board.move
  const [count, setCount] = useState(String(max))
  const [destination, setDestination] = useState(destinations?.[0]?.id ?? '')

  return (
    <DialogShell onClose={onCancel} title={m.title} className="sm:max-w-[360px]" preventClose={pending}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(Math.min(max, Math.max(1, Math.round(Number(count) || 1))), destination || undefined)
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">{toLabel ? m.howMany(requestName, toLabel) : m.toAnotherStage(requestName)}</p>
        {destinations && (
          <MoveDestinationField id="move-destination" value={destination} destinations={destinations} onChange={setDestination} />
        )}
        <Field>
          <FieldLabel htmlFor="move-count">{m.copiesOf(max)}</FieldLabel>
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
        <DialogProblem title={m.problemTitle} hint={m.problemHint} error={error} />
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            {pending ? m.moving : m.move}
          </Button>
        </div>
      </form>
    </DialogShell>
  )
}
