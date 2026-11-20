import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Button } from '@/components/ui/button'
import type { FilamentPreset } from '../../../core/filamentPresets'
import type { PartPreset } from '../../../core/partPresets'
import type { ResinPreset } from '../../../core/resinPresets'
import type { Locale } from '../../../core/i18n'
import { useI18n } from '../../i18n'
import { matchesListSearch } from '../../listSearch'
import { ColourSwatch } from '../ColourSwatch'
import { DialogShell } from '../DialogShell'
import { formatNumber } from '../priceCalculator/format'
import { CardAffordance, CardMark, catalogueCard, CustomCard } from './CatalogueCards'
import { VirtualCatalogue } from './VirtualCatalogue'

type MaterialPreset = ResinPreset | FilamentPreset
type MaterialKind = 'resin' | 'filament'

// A few colours say what range a filament comes in; the rest are counted.
const SHOWN_COLOURS = 6

/** What the catalogue says about a material: its type and density. */
export function materialFacts(preset: MaterialPreset, locale: Locale) {
  const density =
    'densityGramsPerMl' in preset
      ? preset.densityGramsPerMl && `${formatNumber(preset.densityGramsPerMl, locale)} g/mL`
      : 'densityGramsPerCm3' in preset && preset.densityGramsPerCm3 && `${formatNumber(preset.densityGramsPerCm3, locale)} g/cm³`
  return [preset.type, density].filter(Boolean).join(' · ')
}

/**
 * Adds a resin or filament from the catalogue, grouped by brand, or in `change` mode chooses the product an existing
 * one is. A filament already in the library can be added again, as another colour is another spool.
 */
export function MaterialPicker<Preset extends MaterialPreset>({
  kind,
  presets,
  mode = 'add',
  current,
  added,
  onSelect,
  onCustom,
  onClose,
}: {
  kind: MaterialKind
  /** None yet while the catalogue loads. */
  presets: readonly Preset[] | undefined
  mode?: 'add' | 'change'
  /** The product the item being changed is now; without one it is already custom, so that choice is not offered. */
  current?: string
  added?: ReadonlySet<string>
  onSelect: (preset: Preset) => void
  /** Enters a product the catalogue lacks, named after the search that found nothing. */
  onCustom: (name?: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.consumables.picker
  const changing = mode === 'change'
  const [search, setSearch] = useState('')
  const query = search.trim()
  const groups = useMemo(() => {
    if (!presets) return undefined
    const byBrand = new Map<string, Preset[]>()
    for (const preset of presets) {
      if (!matchesListSearch(query, [preset.brand, preset.name, preset.type])) continue
      const group = byBrand.get(preset.brand)
      if (group) group.push(preset)
      else byBrand.set(preset.brand, [preset])
    }
    return [...byBrand].map(([title, items]) => ({ title, items }))
  }, [presets, query])
  const mark = (preset: Preset) =>
    changing ? (preset.id === current ? copy.current : undefined) : added?.has(preset.id) ? copy.added : undefined
  const choose = (action: () => void) => {
    action()
    onClose()
  }
  const card = (preset: Preset) => (
    <MaterialCard key={preset.id} preset={preset} mark={mark(preset)} changing={changing} onClick={() => choose(() => onSelect(preset))} />
  )

  return (
    <DialogShell
      title={changing ? copy.changeTitle : t.settings.consumables[kind === 'resin' ? 'resins' : 'filaments'].add}
      description={changing ? copy.changeDescription : copy.description[kind]}
      className="sm:h-[min(44rem,calc(100dvh-2.5rem))] sm:max-w-2xl"
      // The catalogue owns the scrolling here, so the shell must not scroll as well.
      contentClassName="flex min-h-0 flex-col gap-3 overflow-y-hidden"
      onClose={onClose}
    >
      <InputGroup className="shrink-0 bg-field">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={copy.search}
          placeholder={copy.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </InputGroup>
      <VirtualCatalogue
        query={query}
        groups={groups}
        getKey={(preset) => preset.id}
        renderItem={card}
        before={
          query
            ? groups?.length === 0 && (
                <div className="grid justify-items-center gap-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">{copy.noMatch(query)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => choose(() => onCustom(query))}>
                    {copy.addOwn(query)}
                  </Button>
                </div>
              )
            : (!changing || current) && (
                <CustomCard
                  title={changing ? copy.customChange : copy.custom[kind]}
                  description={changing ? copy.customChangeDescription : copy.customDescription[kind]}
                  onClick={() => choose(() => onCustom())}
                />
              )
        }
      />
    </DialogShell>
  )
}

function MaterialCard({
  preset,
  mark,
  changing,
  onClick,
}: {
  preset: MaterialPreset
  mark?: string
  changing: boolean
  onClick: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.picker
  const colours = 'colors' in preset ? (preset.colors ?? []) : []
  const name = `${preset.brand} ${preset.name}`
  const facts = materialFacts(preset, locale)
  return (
    <button type="button" className={catalogueCard} aria-label={(changing ? copy.choosePreset : copy.addPreset)(name)} onClick={onClick}>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{preset.name}</span>
          {mark && <CardMark>{mark}</CardMark>}
        </span>
        {facts && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
        {colours.length > 0 && (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            {colours.slice(0, SHOWN_COLOURS).map((colour) => (
              <ColourSwatch key={`${colour.hex}-${colour.names.en}`} hex={colour.hex} />
            ))}
            {colours.length > SHOWN_COLOURS && <span className="font-mono">+{colours.length - SHOWN_COLOURS}</span>}
          </span>
        )}
      </span>
      <CardAffordance changing={changing} />
    </button>
  )
}

/** Adds a wear part to a printer model or print type from the parts the catalogue knows fit it, or one of the user's own. */
export function PartPicker({
  title,
  presets,
  had,
  onSelect,
  onCustom,
  onClose,
}: {
  title: string
  /** None yet while the catalogue loads. */
  presets: readonly PartPreset[] | undefined
  /** Catalogue parts the group already has. */
  had: ReadonlySet<string>
  onSelect: (preset: PartPreset) => void
  onCustom: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const consumables = t.settings.consumables
  const copy = consumables.picker
  const choose = (action: () => void) => {
    action()
    onClose()
  }
  return (
    <DialogShell
      title={title}
      description={copy.partsDescription}
      className="sm:max-h-[min(44rem,calc(100dvh-2.5rem))] sm:max-w-2xl"
      contentClassName="flex min-h-0 flex-col overflow-y-hidden"
      onClose={onClose}
    >
      <VirtualCatalogue
        query=""
        groups={presets && [{ items: presets }]}
        getKey={(preset) => preset.id}
        before={<CustomCard title={copy.custom.part} description={copy.customDescription.part} onClick={() => choose(onCustom)} />}
        renderItem={(preset) => (
          <button
            key={preset.id}
            type="button"
            className={catalogueCard}
            aria-label={copy.addPreset(preset.name)}
            onClick={() => choose(() => onSelect(preset))}
          >
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{preset.name}</span>
                {had.has(preset.id) && <CardMark>{copy.added}</CardMark>}
              </span>
              <span className="block text-xs text-muted-foreground">
                {[
                  preset.brand,
                  consumables.parts.lasts(formatNumber(preset.lifespan, locale), consumables.parts.units[preset.lifespanUnit]),
                ].join(' · ')}
              </span>
            </span>
            <CardAffordance changing={false} />
          </button>
        )}
      />
    </DialogShell>
  )
}
