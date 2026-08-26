import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { PrintType } from '../../core/types'
import { MAX_REQUEST_NAME_LENGTH, MAX_REQUEST_QUANTITY, MAX_REQUEST_SOURCE_URL_LENGTH, MIN_REQUEST_QUANTITY } from '../../core/request'
import type { LinkedRequestValues } from '../linkedRequest'
import { printTypeLabel } from '../fleet'
import { DialogProblem } from './DialogProblem'

export function LinkedRequestForm({
  values,
  printTypes,
  pending,
  validation,
  failure,
  onChange,
  onCancel,
  onSubmit,
}: {
  values: LinkedRequestValues
  printTypes: readonly PrintType[]
  pending: boolean
  validation?: string
  failure?: string
  onChange: (patch: Partial<LinkedRequestValues>) => void
  onCancel: () => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field>
        <FieldLabel htmlFor="linked-request-name">Title</FieldLabel>
        <Input
          id="linked-request-name"
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          maxLength={MAX_REQUEST_NAME_LENGTH}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="linked-request-url">Source link</FieldLabel>
        <Input
          id="linked-request-url"
          type="url"
          inputMode="url"
          value={values.sourceUrl}
          onChange={(event) => onChange({ sourceUrl: event.target.value })}
          placeholder="https://…"
          maxLength={MAX_REQUEST_SOURCE_URL_LENGTH}
        />
        <p className="text-xs text-muted-foreground">
          Any link works. Previews are fetched for MakerWorld, Printables, MyMiniFactory, Cults3D and Thingiverse.
        </p>
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
        <Field>
          <FieldLabel htmlFor="linked-request-print-type">Print type</FieldLabel>
          <Select
            items={printTypes.map((printType) => ({ value: printType, label: printTypeLabel(printType) }))}
            value={values.printType}
            onValueChange={(printType) => onChange({ printType: printType ?? '' })}
          >
            <SelectTrigger id="linked-request-print-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printTypes.map((printType) => (
                <SelectItem key={printType} value={printType}>
                  {printTypeLabel(printType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="linked-request-quantity">Copies</FieldLabel>
          <Input
            id="linked-request-quantity"
            type="number"
            inputMode="numeric"
            min={MIN_REQUEST_QUANTITY}
            max={MAX_REQUEST_QUANTITY}
            value={values.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="linked-request-notes">Notes</FieldLabel>
        <Textarea
          id="linked-request-notes"
          rows={3}
          value={values.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder="colour, who it is for — anything the printer should know"
        />
      </Field>
      <FieldError>{validation}</FieldError>
      <DialogProblem
        title="This print could not be added"
        hint="Nothing was added. Check the details and your connection, then try again."
        error={failure}
      />
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {pending ? 'Adding…' : 'Add to queue'}
        </Button>
      </div>
    </form>
  )
}
