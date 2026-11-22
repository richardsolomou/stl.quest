import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getSlicer, slicersFor, type SlicerId } from '../../../core/slicers'
import type { PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'

/** Picks the slicer a printer's files go to, or for a material, the one it uses instead of its printer's. */
export function SlicerField({
  id,
  printType,
  value,
  material = false,
  onChange,
}: {
  id: string
  printType: PrintType
  value?: SlicerId
  material?: boolean
  onChange: (slicer: SlicerId | undefined) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.slicer
  const chosen = getSlicer(value)
  const items = [
    { value: '', label: material ? copy.printers : copy.none },
    ...slicersFor(printType).map((slicer) => ({ value: slicer.id, label: slicer.name })),
  ]
  return (
    <Field>
      <FieldLabel htmlFor={id}>{copy.label}</FieldLabel>
      <Select items={items} value={value ?? ''} onValueChange={(next) => onChange(getSlicer(next ?? undefined)?.id)}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>
        {chosen ? (chosen.openUrl ? copy.opens(chosen.name) : copy.downloads(chosen.name)) : material ? copy.material : copy.unset}
      </FieldDescription>
    </Field>
  )
}
