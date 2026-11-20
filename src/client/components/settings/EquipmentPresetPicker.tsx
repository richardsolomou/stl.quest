import { Plus, Replace, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { EQUIPMENT_KINDS, equipmentPrintType } from '../../../core/equipment'
import {
  equipmentPresetKind,
  equipmentPresetName,
  equipmentPresetWatts,
  STANDALONE_EQUIPMENT_PRESETS,
  type EquipmentPreset,
} from '../../../core/equipmentPresets'
import { useI18n } from '../../i18n'
import { matchesListSearch } from '../../listSearch'
import { DialogShell } from '../DialogShell'
import { formatNumber } from '../priceCalculator/format'
import { CardAffordance, CardMark, catalogueCard, CustomCard } from './CatalogueCards'
import { CatalogueScopeLine, useCatalogueScope } from './CatalogueScope'
import { EquipmentIcon } from './EquipmentIcon'
import { VirtualCatalogue } from './VirtualCatalogue'

/** Adds equipment from the catalogue, or in `change` mode chooses the catalogue model of an existing item. */
export function EquipmentPresetPicker({
  mode = 'add',
  variant = 'outline',
  label,
  added,
  current,
  disabled,
  onSelect,
  onCustom,
}: {
  mode?: 'add' | 'change'
  variant?: 'default' | 'outline'
  label?: string
  added?: ReadonlySet<string>
  /** The model the item being changed has now; without one it is already custom, so that choice is not offered. */
  current?: string
  disabled?: boolean
  onSelect: (preset: EquipmentPreset) => void
  onCustom: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { t, locale } = useI18n()
  const copy = t.settings.equipment
  const changing = mode === 'change'
  const scope = useCatalogueScope()
  const close = () => {
    setOpen(false)
    setSearch('')
    scope.setShowAll(false)
  }
  const choose = (action: () => void) => {
    action()
    close()
  }
  const found = STANDALONE_EQUIPMENT_PRESETS.filter(
    (preset) =>
      scope.lists(equipmentPrintType({ kind: equipmentPresetKind(preset), printType: preset.printType })) &&
      matchesListSearch(search, [preset.brand, preset.model, copy.kinds[equipmentPresetKind(preset)]]),
  )
  const groups = EQUIPMENT_KINDS.map((kind) => ({
    title: copy.kinds[kind],
    items: found.filter((preset) => equipmentPresetKind(preset) === kind),
  })).filter(({ items }) => items.length > 0)
  const mark = (preset: EquipmentPreset) =>
    changing ? (preset.id === current ? copy.picker.current : undefined) : added?.has(preset.id) ? copy.picker.added : undefined

  return (
    <>
      {changing ? (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
          <Replace /> {current ? copy.dialog.changeModel : copy.dialog.chooseModel}
        </Button>
      ) : (
        <Button type="button" variant={variant} className="self-start" disabled={disabled} onClick={() => setOpen(true)}>
          <Plus /> {label ?? copy.add}
        </Button>
      )}
      {open && (
        <DialogShell
          title={changing ? copy.picker.changeTitle : copy.picker.title}
          description={copy.picker.description}
          className="sm:h-[min(44rem,calc(100dvh-2.5rem))] sm:max-w-2xl"
          contentClassName="flex min-h-0 flex-col gap-3 overflow-y-hidden"
          onClose={close}
        >
          <InputGroup className="shrink-0 bg-field">
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={copy.picker.search}
              placeholder={copy.picker.search}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
          <CatalogueScopeLine scope={scope} />
          <VirtualCatalogue
            query={search.trim()}
            groups={groups}
            getKey={(preset) => preset.id}
            renderItem={(preset) => {
              const marked = mark(preset)
              const name = equipmentPresetName(preset)
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={(changing ? copy.picker.choosePreset : copy.picker.addPreset)(name)}
                  className={catalogueCard}
                  onClick={() => choose(() => onSelect(preset))}
                >
                  <EquipmentIcon kind={equipmentPresetKind(preset)} image={preset.image} className="size-14" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium sm:truncate">{name}</span>
                    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {copy.watts(formatNumber(equipmentPresetWatts(preset), locale))}
                        {preset.printType && ` · ${copy.printTypes[preset.printType]}`}
                      </span>
                      {marked && <CardMark>{marked}</CardMark>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {changing ? copy.picker.chooseHint : copy.picker.presetHint}
                    </span>
                  </span>
                  <CardAffordance changing={changing} />
                </button>
              )
            }}
            before={
              search.trim()
                ? groups.length === 0 && (
                    <p className="py-10 text-center text-sm text-muted-foreground">{copy.picker.noMatch(search.trim())}</p>
                  )
                : (!changing || current) && (
                    <CustomCard
                      title={changing ? copy.picker.customChange : copy.picker.custom}
                      description={changing ? copy.picker.customChangeDescription : copy.picker.customDescription}
                      onClick={() => choose(onCustom)}
                    />
                  )
            }
          />
        </DialogShell>
      )}
    </>
  )
}
