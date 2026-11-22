import { useId, type ReactNode } from 'react'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { consumablesOfKind, type Consumable } from '../../../core/consumables'
import type { PlateMaterialChoice } from '../../../core/plates'
import type { SlicedFilament } from '../../../core/slicedPlate'
import type { PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'
import { ColourSwatch } from '../ColourSwatch'

export type MaterialDraft = { consumableId?: string; other?: boolean; name?: string; price?: string }

const OTHER = 'other'
const NONE = 'none'

/** The material a draft names, or undefined while it names none. */
export function plateMaterialChoice(draft: MaterialDraft): PlateMaterialChoice | undefined {
  if (draft.consumableId) return { consumableId: draft.consumableId }
  const name = draft.name?.trim()
  if (!draft.other || !name) return undefined
  const price = Number(draft.price)
  return { name, ...(draft.price?.trim() && price > 0 && { price }) }
}

/** A library material of the plate's print type, or one outside the library named and priced on the spot. */
export function PlateMaterialField({
  label,
  printType,
  library,
  fromFile,
  value,
  onChange,
  trailing,
}: {
  label: string
  printType: PrintType
  library: Consumable[]
  fromFile?: SlicedFilament
  value: MaterialDraft
  onChange: (value: MaterialDraft) => void
  /** Sits beside the picker, such as the amount the material used. */
  trailing?: ReactNode
}) {
  const { t } = useI18n()
  const copy = t.plates.material
  const id = useId()
  const materials = consumablesOfKind(library, printType)
  const options = [
    ...materials.map((material) => ({
      value: material.id,
      label: material.name,
      hex: material.kind === 'filament' ? material.colour?.hex : undefined,
    })),
    { value: OTHER, label: copy.somethingElse, hex: undefined },
  ]
  const selected = value.other ? OTHER : (value.consumableId ?? NONE)
  const chosen = options.find((option) => option.value === selected)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field className={value.other && !trailing ? undefined : 'sm:col-span-2'}>
        <FieldLabel htmlFor={`${id}-material`}>{label}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            items={options}
            value={selected}
            onValueChange={(next) =>
              onChange(
                next === OTHER
                  ? { other: true, name: value.name, price: value.price }
                  : next && next !== NONE
                    ? { consumableId: next }
                    : {},
              )
            }
          >
            <SelectTrigger className="min-w-0 flex-1 basis-40" id={`${id}-material`}>
              <SelectValue>
                {chosen?.hex && <ColourSwatch hex={chosen.hex} />}
                <span className="truncate">{chosen?.label ?? copy.choose}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.hex && <ColourSwatch hex={option.hex} className="self-center" />}
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {trailing}
        </div>
        {fromFile?.type && (
          <FieldDescription className="flex items-center gap-1.5">
            {fromFile.color && <ColourSwatch hex={fromFile.color} />}
            {copy.fromFile(fromFile.type)}
          </FieldDescription>
        )}
      </Field>
      {value.other && (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>{copy.name}</FieldLabel>
            <Input
              id={`${id}-name`}
              value={value.name ?? ''}
              maxLength={120}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
            />
          </Field>
          <Field className={trailing ? undefined : 'sm:col-span-2'}>
            <FieldLabel htmlFor={`${id}-price`}>{printType === 'resin' ? copy.pricePerLitre : copy.pricePerKg}</FieldLabel>
            <Input
              id={`${id}-price`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={value.price ?? ''}
              onChange={(event) => onChange({ ...value, price: event.target.value })}
            />
            <FieldDescription>{copy.priceHint}</FieldDescription>
          </Field>
        </>
      )}
    </div>
  )
}
