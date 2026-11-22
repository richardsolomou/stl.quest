import { format } from 'date-fns'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { ownedFor } from '../../../core/maintenance'
import { useI18n } from '../../i18n'
import { DatePicker } from '../DatePicker'

/** When a printer or piece of equipment was bought, and how long ago that was. */
export function PurchaseDateField({ id, value, onChange }: { id: string; value?: string; onChange: (value?: string) => void }) {
  const copy = useI18n().t.settings.purchaseDate
  const age = value && ownedFor(value, format(new Date(), 'yyyy-MM-dd'))
  return (
    <Field className="gap-1">
      <FieldLabel htmlFor={id} className="text-xs text-muted-foreground">
        {copy.label}
      </FieldLabel>
      <DatePicker id={id} past value={value} label={copy.placeholder} onChange={onChange} />
      {age && <FieldDescription className="text-xs">{copy.age(age.years, age.months)}</FieldDescription>}
    </Field>
  )
}
