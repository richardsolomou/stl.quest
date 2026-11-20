import { Link } from '@tanstack/react-router'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@/components/ui/field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FilamentConsumable, ResinConsumable } from '../../../core/consumables'
import type { EquipmentItem } from '../../../core/equipment'
import { TYPICAL_FILAMENT_PRICE_PER_KG, TYPICAL_RESIN_PRICE_PER_LITRE, type PriceCalculatorCurrency } from '../../../core/priceCalculator'
import type { PrinterProfile, PrintType } from '../../../core/types'
import { useI18n } from '../../i18n'
import { ColourSwatch } from '../ColourSwatch'
import { Docket } from '../settings/SettingsLayout'
import { formatMoney } from './format'

export type JobMaterial = ResinConsumable | FilamentConsumable

// Base UI reserves an empty value for no selection, so picking nothing needs its own value.
const NONE = 'none'

/** What the job runs on and uses; each is optional, and the quote falls back to typical values for anything left empty. */
export function JobPickers({
  printType,
  printTypes,
  currency,
  printers,
  printer,
  materials,
  material,
  equipment,
  chosenEquipment,
  onPrintTypeChange,
  onPrinterChange,
  onMaterialChange,
  onEquipmentChange,
}: {
  printType: PrintType
  /** The types the workspace prints; with one there is no switch, and the setup starts on it. */
  printTypes: readonly PrintType[]
  currency: PriceCalculatorCurrency
  printers: PrinterProfile[]
  printer?: PrinterProfile
  materials: JobMaterial[]
  material?: JobMaterial
  equipment: EquipmentItem[]
  chosenEquipment: EquipmentItem[]
  onPrintTypeChange: (printType: PrintType) => void
  onPrinterChange: (printerId: string | undefined) => void
  onMaterialChange: (materialId: string | undefined) => void
  onEquipmentChange: (equipmentIds: string[]) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.calculator.job
  const money = (value: number) => formatMoney(value, currency, locale)
  const printerOptions = [{ value: NONE, label: copy.anyPrinter }, ...printers.map(({ id, name }) => ({ value: id, label: name }))]
  const typicalMaterial =
    printType === 'resin'
      ? copy.typicalResin(money(TYPICAL_RESIN_PRICE_PER_LITRE))
      : copy.typicalFilament(money(TYPICAL_FILAMENT_PRICE_PER_KG))
  const materialOptions = [
    { value: NONE, label: typicalMaterial, hex: undefined as string | undefined },
    ...materials.map((item) => ({ value: item.id, label: item.name, hex: item.kind === 'filament' ? item.colour?.hex : undefined })),
  ]
  return (
    <Docket title={copy.setupTitle} className="lg:col-start-1 lg:row-start-1">
      <div className="grid gap-4 sm:grid-cols-2">
        {printTypes.length > 1 && (
          <Field className="sm:col-span-2">
            <FieldTitle>{copy.printType}</FieldTitle>
            <SegmentedControl
              legend={copy.printType}
              value={printType}
              options={printTypes.map((value) => ({ value, label: copy[value], id: `calculator-print-type-${value}` }))}
              onChange={onPrintTypeChange}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="calculator-printer">{copy.printer}</FieldLabel>
          <Select
            items={printerOptions}
            value={printer?.id ?? NONE}
            onValueChange={(value) => onPrinterChange(value && value !== NONE ? value : undefined)}
          >
            <SelectTrigger className="w-full" id="calculator-printer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printerOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="calculator-material-consumable">{copy.material}</FieldLabel>
          <Select
            items={materialOptions}
            value={material?.id ?? NONE}
            onValueChange={(value) => onMaterialChange(value && value !== NONE ? value : undefined)}
          >
            <SelectTrigger className="w-full" id="calculator-material-consumable">
              <SelectValue>
                {material?.kind === 'filament' && material.colour && <ColourSwatch hex={material.colour.hex} />}
                <span className="truncate">{material?.name ?? typicalMaterial}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {materialOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.hex && <ColourSwatch hex={option.hex} className="self-center" />}
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!materials.length && (
            <FieldDescription>
              {copy.materialHint[printType]}{' '}
              <Link to="/settings/$section" params={{ section: 'consumables' }} className="underline underline-offset-2">
                {copy.consumablesLink}
              </Link>
              .
            </FieldDescription>
          )}
        </Field>
        <EquipmentPicker printType={printType} equipment={equipment} chosen={chosenEquipment} onChange={onEquipmentChange} />
      </div>
    </Docket>
  )
}

function EquipmentPicker({
  printType,
  equipment,
  chosen,
  onChange,
}: {
  printType: PrintType
  equipment: EquipmentItem[]
  chosen: EquipmentItem[]
  onChange: (equipmentIds: string[]) => void
}) {
  const copy = useI18n().t.calculator.job
  const anchor = useComboboxAnchor()
  const hint = chosen.length || printType === 'filament' ? copy.equipmentHint : copy.equipmentTypical
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor="calculator-equipment">{copy.equipment}</FieldLabel>
      {equipment.length ? (
        <Combobox
          multiple
          items={equipment}
          value={chosen}
          itemToStringLabel={(item: EquipmentItem) => item.name}
          onValueChange={(next: EquipmentItem[]) => onChange(next.map(({ id }) => id))}
        >
          <ComboboxChips ref={anchor}>
            {chosen.map((item) => (
              <ComboboxChip key={item.id} title={item.name}>
                {item.name}
              </ComboboxChip>
            ))}
            <ComboboxChipsInput id="calculator-equipment" placeholder={copy.equipmentSearch} />
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxEmpty>{copy.equipmentEmpty}</ComboboxEmpty>
            <ComboboxList>
              <ComboboxCollection>
                {(item: EquipmentItem) => (
                  <ComboboxItem key={item.id} value={item} aria-label={item.name}>
                    {item.name}
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : null}
      <FieldDescription>
        {equipment.length ? (
          hint
        ) : (
          <>
            {printType === 'resin' && `${copy.equipmentTypical} `}
            {copy.noEquipment[printType]}{' '}
            <Link to="/settings/$section" params={{ section: 'equipment' }} className="underline underline-offset-2">
              {copy.equipmentLink}
            </Link>
            .
          </>
        )}
      </FieldDescription>
    </Field>
  )
}
