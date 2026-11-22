import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Info, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { consumablesOfKind, type Consumable } from '../../../core/consumables'
import { wearingParts } from '../../../core/maintenance'
import { getPrinterPreset } from '../../../core/printerPresets'
import { missingMaterials, missingWearParts, untrackedConsumables, type PartSuggestion } from '../../../core/stock'
import type { PrinterProfile, PrintType } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { catalogueQuery, printerLifetimesQuery } from '../../queries'
import { formatNumber } from '../priceCalculator/format'
import { formatStock, LowMarker, StockMovementForm } from './ConsumableStock'
import { ReplacedButton, WearText } from './PrinterMaintenance'

// A farm with many models could otherwise push the consumables themselves off the first screen.
const SHOWN_PER_LIST = 4

/**
 * What to buy: tracked consumables that are low or gone, wear parts nearly worn or due on a printer, then what the fleet uses that the library lacks, from the
 * parts catalogue and missing materials. Adding one opens it to be priced.
 */
export function SupplyNeeds({
  workspaceSlug,
  consumables: library,
  levels: loadedLevels,
  printers,
  printTypes,
  onAddMaterial,
  onAddPart,
}: {
  workspaceSlug: string
  consumables: Consumable[]
  /** Undefined while stock loads, so nothing claims what is or isn't tracked yet. */
  levels?: StockLevel[]
  printers: PrinterProfile[]
  /** What the workspace prints; nothing is suggested for another type. */
  printTypes: readonly PrintType[]
  onAddMaterial: (printType: PrintType) => void
  onAddPart: (suggestion: PartSuggestion) => void
}) {
  const { t, locale } = useI18n()
  const consumables = t.settings.consumables
  const copy = consumables.needs
  const stock = consumables.stock
  const levels = loadedLevels ?? []
  const runningOut = levels.flatMap((level) => {
    const consumable = library.find(({ id }) => id === level.consumableId)
    return consumable && !consumable.archived && (level.low || level.missing) ? [{ consumable, level }] : []
  })
  const materials = missingMaterials(library, printers).filter(({ printType }) => printTypes.includes(printType))
  const catalogue = useQuery(catalogueQuery('parts')).data ?? []
  const parts = missingWearParts(library, printers, catalogue).filter(({ printType }) => printTypes.includes(printType))
  const lifetimes = useQuery(printerLifetimesQuery(workspaceSlug)).data?.lifetimes ?? []
  const wearing = wearingParts(lifetimes).flatMap(({ printerId, wear }) => {
    const printer = printers.find(({ id }) => id === printerId)
    const part = consumablesOfKind(library, 'part').find(({ id }) => id === wear.consumableId)
    return printer && !printer.archived && part ? [{ printer, part, wear }] : []
  })
  const nothing = runningOut.length === 0 && wearing.length === 0 && materials.length === 0 && parts.length === 0
  const untracked = untrackedConsumables(library, levels)

  const modelName = (printerPresetId: string) => {
    const preset = getPrinterPreset(printerPresetId)
    return preset ? `${preset.brand} ${preset.model}` : printerPresetId
  }

  return (
    <section aria-labelledby="supply-needs" className="grid gap-3 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex min-w-0 items-baseline gap-3">
        <h2 id="supply-needs" className="font-heading text-base leading-tight font-bold tracking-[0.01em] uppercase">
          {copy.title}
        </h2>
        {nothing && loadedLevels && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {untracked ? (
              <Info aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
            )}
            {untracked ? copy.untracked(untracked) : copy.allSet}
          </p>
        )}
      </div>
      {!nothing && <p className="-mt-1.5 text-sm text-muted-foreground">{copy.description}</p>}
      {runningOut.length > 0 && (
        <NeedList title={copy.runningOut} count={runningOut.length}>
          {runningOut.map(({ consumable, level }) => (
            <NeedRow
              key={consumable.id}
              name={consumable.name}
              detail={
                level.missing ? (
                  <span className="font-medium text-destructive">{stock.none}</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5">
                    <LowMarker />
                    {stock.left(formatStock(level.onHand, consumable, locale, stock))}
                    {level.minimum !== undefined && `· ${stock.warnsBelow(formatStock(level.minimum, consumable, locale, stock))}`}
                  </span>
                )
              }
              action={<RestockPopover workspaceSlug={workspaceSlug} consumable={consumable} onHand={level.onHand} />}
            />
          ))}
        </NeedList>
      )}
      {wearing.length > 0 && (
        <NeedList title={copy.wearingOut} count={wearing.length}>
          {wearing.map(({ printer, part, wear }) => (
            <NeedRow
              key={`${printer.id}-${part.id}`}
              name={part.name}
              detail={
                <>
                  {copy.wornOn(printer.name)} · <WearText wear={wear} />
                </>
              }
              action={<ReplacedButton printerId={printer.id} part={part} />}
            />
          ))}
        </NeedList>
      )}
      {materials.length + parts.length > 0 && (
        <NeedList title={copy.missing} count={materials.length + parts.length}>
          {materials.map(({ printType, printers: count }) => (
            <NeedRow
              key={printType}
              name={copy.material[printType]}
              detail={copy.materialHint[printType](count)}
              action={<AddButton label={copy.addLabel(copy.material[printType])} onClick={() => onAddMaterial(printType)} />}
            />
          ))}
          {parts.map((suggestion) => {
            const { preset, printerPresetId, printType, printers: count } = suggestion
            const owner = printerPresetId
              ? copy.partFits(modelName(printerPresetId), count)
              : copy.partGeneric(copy.printTypes[printType], count)
            const lasts = copy.lasts(`${formatNumber(preset.lifespan, locale)} ${consumables.parts.units[preset.lifespanUnit]}`)
            return (
              <NeedRow
                key={`${printerPresetId ?? printType}-${preset.id}`}
                name={preset.name}
                detail={`${owner} · ${lasts}`}
                action={<AddButton label={copy.addLabel(preset.name)} onClick={() => onAddPart(suggestion)} />}
              />
            )
          })}
        </NeedList>
      )}
    </section>
  )
}

function NeedList({ title, count, children }: { title: string; count: number; children: ReactNode[] }) {
  const more = useI18n().t.settings.consumables.needs
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? children : children.slice(0, SHOWN_PER_LIST)
  return (
    <div className="grid min-w-0 gap-1">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-mono text-xs font-normal text-muted-foreground">{count}</span>
      </h3>
      <ul className="grid min-w-0 divide-y">{shown}</ul>
      {children.length > SHOWN_PER_LIST && (
        <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setExpanded((current) => !current)}>
          {expanded ? more.showFewer : more.showAll(children.length)}
        </Button>
      )}
    </div>
  )
}

function NeedRow({ name, detail, action }: { name: string; detail: ReactNode; action: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium [overflow-wrap:anywhere]">{name}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </li>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  const copy = useI18n().t.settings.consumables.needs
  return (
    <Button type="button" variant="outline" size="sm" aria-label={label} onClick={onClick}>
      <Plus /> {copy.add}
    </Button>
  )
}

function RestockPopover({ workspaceSlug, consumable, onHand }: { workspaceSlug: string; consumable: Consumable; onHand: number }) {
  const copy = useI18n().t.settings.consumables
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" size="sm" aria-label={copy.needs.restockLabel(consumable.name)}>
            {copy.stock.actions.restock}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-0">
        <StockMovementForm
          className="border-0 bg-transparent"
          workspaceSlug={workspaceSlug}
          consumable={consumable}
          kind="restock"
          onHand={onHand}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
