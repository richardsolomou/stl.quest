import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '../i18n'

export type MoveDestination = { id: string; label: string }

export function MoveDestinationField({
  id,
  value,
  destinations,
  onChange,
}: {
  id: string
  value: string
  destinations: MoveDestination[]
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  return (
    <Field className="mb-3">
      <FieldLabel htmlFor={id}>{t.board.move.destination}</FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(next ?? '')}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{destinations.find((option) => option.id === value)?.label}</SelectValue>
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
  )
}
