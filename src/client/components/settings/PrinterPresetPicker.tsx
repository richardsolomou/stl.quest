import { Plus, Replace, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { filterPrinterPresets, PRINTER_PRESETS, type PrinterPreset } from '../../../core/printerPresets'
import { cn } from '@/lib/utils'
import type { PrintType } from '../../../core/types'
import { DialogShell } from '../DialogShell'
import { PrinterPresetImage } from './PrinterPresetImage'
import { useI18n } from '../../i18n'
import { CardAffordance, CardMark, catalogueCard, CustomCard } from './CatalogueCards'
import { CatalogueScopeLine, useCatalogueScope } from './CatalogueScope'
import { VirtualCatalogue } from './VirtualCatalogue'

/**
 * Adds a printer from the catalogue, or in `change` mode chooses the catalogue model of an existing one. A `printType`
 * keeps the catalogue to that kind of printer, for the add in a print type's own section; otherwise it opens on what
 * the workspace prints.
 */
export function PrinterPresetPicker({
  disabled,
  variant = 'outline',
  size,
  label,
  printType,
  mode = 'add',
  added,
  current,
  onSelect,
  onCustom,
}: {
  disabled?: boolean
  variant?: 'default' | 'outline' | 'link'
  size?: 'sm'
  label?: string
  printType?: PrintType
  mode?: 'add' | 'change'
  added?: ReadonlySet<string>
  /** The model the printer being changed has now; without one it is already custom, so that choice is not offered. */
  current?: string
  onSelect: (preset: PrinterPreset) => void
  onCustom: () => void
}) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const copy = t.settings.printerPicker
  const changing = mode === 'change'
  const marked = (preset: PrinterPreset) =>
    changing ? (preset.id === current ? copy.current : undefined) : added?.has(preset.id) ? copy.added : undefined
  const [search, setSearch] = useState('')
  const query = search.trim()
  const scope = useCatalogueScope(printType)
  const { lists } = scope
  const catalogue = useMemo(() => PRINTER_PRESETS.filter((preset) => lists(preset.printType)), [lists])
  const { presets: results, closest } = useMemo(() => filterPrinterPresets(query, catalogue), [query, catalogue])
  const groups = useMemo(() => groupPresets(results), [results])
  const close = () => {
    setOpen(false)
    setSearch('')
    scope.setShowAll(false)
  }
  const choose = (action: () => void) => {
    action()
    close()
  }

  return (
    <>
      {changing ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
          <Replace /> {current ? t.settings.printers.dialog.changeModel : t.settings.printers.dialog.chooseModel}
        </Button>
      ) : (
        <Button
          type="button"
          variant={variant}
          size={size}
          className="justify-self-start"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          {variant !== 'link' && <Plus />} <span className={cn(size === 'sm' && 'max-sm:sr-only')}>{label ?? copy.add}</span>
        </Button>
      )}
      {open && (
        <DialogShell
          title={changing ? copy.changeTitle : (label ?? copy.title)}
          description={changing ? copy.changeDescription : copy.description}
          className="sm:h-[min(44rem,calc(100dvh-2.5rem))] sm:max-w-2xl"
          // The result list owns the scrolling here, so the shell must not scroll as well.
          contentClassName="flex min-h-0 flex-col gap-3 overflow-y-hidden"
          onClose={close}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={copy.searchLabel}
              placeholder={copy.searchPlaceholder}
              value={search}
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <CatalogueScopeLine scope={scope} />
          <VirtualCatalogue
            query={query}
            groups={groups}
            getKey={(preset) => preset.id}
            renderItem={(preset) => (
              <PresetButton
                key={preset.id}
                preset={preset}
                mark={marked(preset)}
                changing={changing}
                onClick={() => choose(() => onSelect(preset))}
              />
            )}
            before={
              query ? (
                groups.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{copy.noMatch(query)}</p>
                ) : (
                  closest && <p className="text-sm text-muted-foreground">{copy.closestMatches(query)}</p>
                )
              ) : (
                (!changing || current) && (
                  <CustomCard
                    title={changing ? copy.customChange : copy.custom}
                    description={changing ? copy.customChangeDescription : copy.customDescription}
                    onClick={() => choose(onCustom)}
                  />
                )
              )
            }
          />
        </DialogShell>
      )}
    </>
  )
}

function PresetButton({
  preset,
  mark,
  changing,
  onClick,
}: {
  preset: PrinterPreset
  mark?: string
  changing: boolean
  onClick: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.printerPicker
  return (
    <button
      type="button"
      className={cn(catalogueCard, 'h-full')}
      aria-label={(changing ? copy.choosePreset : copy.addPreset)(`${preset.brand} ${preset.model}`)}
      onClick={onClick}
    >
      <PrinterPresetImage printer={preset} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <span className="min-w-0 font-medium sm:truncate">{preset.model}</span>
          <Badge variant="outline" className="shrink-0 text-[0.65rem]">
            {t.settings.printers.printTypes[preset.printType]}
          </Badge>
          {mark && <CardMark>{mark}</CardMark>}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{changing ? copy.chooseHint : copy.presetHint}</span>
      </span>
      <CardAffordance changing={changing} />
    </button>
  )
}

function groupPresets(presets: readonly PrinterPreset[]) {
  const groups = new Map<string, PrinterPreset[]>()
  for (const preset of presets) {
    const group = groups.get(preset.brand)
    if (group) group.push(preset)
    else groups.set(preset.brand, [preset])
  }
  return [...groups].map(([title, items]) => ({ title, items }))
}
