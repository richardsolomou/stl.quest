import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  return (
    <Field className="mb-3">
      <FieldLabel htmlFor={id}>Destination</FieldLabel>
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
