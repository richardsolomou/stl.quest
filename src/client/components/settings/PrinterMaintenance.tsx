import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { newWearPart, wearPartsFor, withConsumablePrice, type Consumable, type PartConsumable } from '../../../core/consumables'
import { partPresetsForGroup } from '../../../core/partPresets'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, measuredFailurePercent, MIN_MEASURED_FAILURE_RUNS } from '../../../core/priceCalculator'
import { partFromPreset } from '../../../core/stock'
import { wearLevel, type PartWear, type WearLevel } from '../../../core/maintenance'
import type { PrinterProfile } from '../../../core/types'
import type { StockLevel } from '../../../core/usage'
import { useI18n } from '../../i18n'
import { createId } from '../../id'
import { useInventory } from '../../inventory'
import {
  catalogueQuery,
  consumablesQuery,
  priceCalculatorSettingsQuery,
  printerLifetimesQuery,
  printersQuery,
  stockQuery,
  storesQuery,
} from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { currencySymbol, formatNumber, formatRate } from '../priceCalculator/format'
import { ConsumableDialog } from './ConsumableDialog'
import { PartPicker } from './ConsumablePicker'
import { useStockMovements } from './ConsumableStock'

/**
 * The wear parts a saved printer uses, each counted from the prints it ran since the part was last replaced on it.
 * Logging a replacement takes a spare off the shelf and starts the count again.
 */
export function PrinterMaintenance({ printer }: { printer: PrinterProfile }) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  const workspaceSlug = useWorkspaceSlug()
  const consumables = useQuery(consumablesQuery(workspaceSlug)).data?.consumables
  const lifetime = usePrinterLifetime(printer.id)
  const levels = useQuery(stockQuery(workspaceSlug)).data?.stock ?? []
  const printers = useQuery(printersQuery(workspaceSlug)).data?.profiles ?? []
  const catalogue = useQuery(catalogueQuery('parts')).data
  const stores = useQuery(storesQuery(workspaceSlug)).data?.stores ?? []
  const currency =
    useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const { save, setArchived } = useInventory('consumables')
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Consumable | null>(null)
  if (!consumables || !lifetime) return null
  const parts = wearPartsFor(consumables, printer.printType, printer)
  // A catalogue printer's parts belong to its model, as on the Consumables page; a custom printer's to it alone.
  const group = printer.presetId
    ? { printType: printer.printType, printerPresetId: printer.presetId }
    : { printType: printer.printType, printerId: printer.id }
  const presets = catalogue && partPresetsForGroup(catalogue, group)
  const add = () => (!catalogue || presets?.length ? setPicking(true) : setEditing(newWearPart(createId(), group)))
  const failed = () => void toast.error(t.settings.consumables.notSaved)
  const archive = (part: Consumable) => {
    setEditing(null)
    setArchived(part.id, true).then(
      () =>
        toast(t.settings.consumables.archivedItem(part.name), {
          action: { label: t.settings.consumables.undo, onClick: () => void setArchived(part.id, false).catch(failed) },
        }),
      failed,
    )
  }
  return (
    <section className="grid gap-2" aria-labelledby="printer-maintenance">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 id="printer-maintenance" className="text-sm font-medium">
            {copy.title}
          </h3>
          <p className="text-sm text-muted-foreground">{parts.length ? copy.hint : copy.empty}</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus /> {copy.add}
        </Button>
      </div>
      {parts.length > 0 && (
        <ul className="grid divide-y rounded-lg border bg-muted/20 px-3">
          {parts.map((part) => (
            <WearPartRow
              key={part.id}
              printerId={printer.id}
              part={part}
              wear={lifetime.parts.find(({ consumableId }) => consumableId === part.id) ?? unworn(part)}
              level={levels.find(({ consumableId }) => consumableId === part.id)}
              onEdit={() => setEditing(part)}
            />
          ))}
        </ul>
      )}
      {picking && (
        <PartPicker
          title={t.settings.consumables.parts.addTo(printer.name)}
          groups={
            presets && [{ items: presets.map((preset) => ({ preset, had: parts.some(({ partPresetId }) => partPresetId === preset.id) })) }]
          }
          onSelect={({ preset }) => setEditing(withConsumablePrice(partFromPreset(createId(), { preset, ...group }), Number.NaN))}
          onCustom={() => setEditing(newWearPart(createId(), group))}
          onClose={() => setPicking(false)}
        />
      )}
      {editing && (
        <ConsumableDialog
          key={editing.id}
          consumable={editing}
          library={consumables}
          stores={stores}
          isNew={!consumables.some(({ id }) => id === editing.id)}
          workspaceSlug={workspaceSlug}
          level={levels.find(({ consumableId }) => consumableId === editing.id)}
          printers={printers}
          symbol={currencySymbol(currency, locale)}
          rate={(value) => formatRate(value, currency, locale)}
          onSave={save}
          onArchive={() => archive(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

/** A part just added to the library, which the lifetimes do not list until they are read again. */
function unworn(part: PartConsumable): PartWear {
  return { consumableId: part.id, used: 0, lifespan: part.lifespan, unit: part.lifespanUnit, level: 'fresh' }
}

/** How many print hours a saved printer has run against the lifespan being edited, so the two stay in step. */
export function PrinterLifetimeLine({ printerId, lifespanHours }: { printerId: string; lifespanHours?: number }) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog
  const lifetime = usePrinterLifetime(printerId)
  if (!lifetime) return null
  const level = wearLevel(lifetime.hours, lifespanHours ?? 0)
  return (
    <div className="grid gap-1.5 sm:max-w-md">
      <p className={cn('font-mono text-xs tabular-nums', level === 'due' ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
        {level === 'due' && `${copy.pastLifespan} · `}
        {copy.lifetime(formatNumber(lifetime.hours, locale, 1), lifespanHours ? formatNumber(lifespanHours, locale) : undefined)}
      </p>
      {lifespanHours && <WearBar used={lifetime.hours} lifespan={lifespanHours} level={level} />}
      {lifetime.runs && (
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {copy.runs(
            lifetime.runs.runs,
            lifetime.runs.failed,
            new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
              measuredFailurePercent(lifetime.runs) / 100,
            ),
          )}
          {` · ${copy.runsPricing(MIN_MEASURED_FAILURE_RUNS, lifetime.runs.runs >= MIN_MEASURED_FAILURE_RUNS)}`}
        </p>
      )}
    </div>
  )
}

export function usePrinterLifetime(printerId: string) {
  const workspaceSlug = useWorkspaceSlug()
  return useQuery(printerLifetimesQuery(workspaceSlug)).data?.lifetimes.find((lifetime) => lifetime.printerId === printerId)
}

/** The thin bar wear reads as: ink while fresh, amber once nearly worn, red when due. */
export function WearBar({ used, lifespan, level }: { used: number; lifespan: number; level: WearLevel }) {
  const ratio = lifespan > 0 ? Math.min(1, used / lifespan) : 0
  return (
    <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full',
          level === 'due' ? 'bg-destructive' : level === 'nearly' ? 'bg-(--stage-in_progress)' : 'bg-foreground/45',
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}

/** A part's wear as text, such as "Due · 190 of 190 prints". */
export function WearText({ wear }: { wear: PartWear }) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  return (
    <span className={cn('font-mono tabular-nums', wear.level === 'due' && 'font-semibold text-destructive')}>
      {wear.level === 'due' && `${copy.due} · `}
      {copy.wear(formatNumber(wear.used, locale, wear.unit === 'hours' ? 1 : 0), formatNumber(wear.lifespan, locale), wear.unit)}
    </span>
  )
}

/**
 * Logs a new part fitted on the printer, taking a spare off the shelf, with Undo until it is closed. A list that drops
 * the row once the part is fresh again holds the replacement itself, so its Undo outlives the row's own state.
 */
export function ReplacedButton({
  printerId,
  part,
  replacement: heldReplacement,
  onReplacementChange,
}: {
  printerId: string
  part: PartConsumable
  replacement?: string
  onReplacementChange?: (transactionId: string | undefined) => void
}) {
  const { t } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  const workspaceSlug = useWorkspaceSlug()
  const { movement, undo } = useStockMovements(workspaceSlug)
  const [ownReplacement, setOwnReplacement] = useState<string>()
  const replacement = onReplacementChange ? heldReplacement : ownReplacement
  const setReplacement = onReplacementChange ?? setOwnReplacement
  const failed = movement.error != null || undo.error != null
  return (
    <div className="grid shrink-0 justify-items-end gap-1">
      {replacement ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={undo.isPending}
          onClick={() => undo.mutate(replacement, { onSuccess: () => setReplacement(undefined) })}
        >
          {copy.undo}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={copy.replacedLabel(part.name)}
          disabled={movement.isPending}
          onClick={() =>
            movement.mutate(
              { consumableId: part.id, kind: 'replace', amount: 1, printerId },
              { onSuccess: ({ transactionId }) => setReplacement(transactionId) },
            )
          }
        >
          {movement.isPending && <Spinner />} {copy.replaced}
        </Button>
      )}
      {failed && <FieldError className="text-xs">{copy.error}</FieldError>}
    </div>
  )
}

function WearPartRow({
  printerId,
  part,
  wear,
  level,
  onEdit,
}: {
  printerId: string
  part: PartConsumable
  wear: PartWear
  level?: StockLevel
  onEdit: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.printers.dialog.maintenance
  const spares = level?.tracked ? Math.max(0, level.onHand) : undefined
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const details = [
    wear.replacedAt === undefined ? copy.neverReplaced : copy.replacedOn(date.format(wear.replacedAt)),
    spares === undefined ? undefined : spares > 0 ? copy.spares(formatNumber(spares, locale)) : copy.noSpares,
  ].filter(Boolean)
  return (
    <li className="grid gap-1.5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            className="cursor-pointer text-left text-sm font-medium [overflow-wrap:anywhere] underline-offset-2 hover:underline"
            aria-label={copy.editLabel(part.name)}
            onClick={onEdit}
          >
            {part.name}
          </button>
          <p className="text-xs text-muted-foreground">
            <WearText wear={wear} />
          </p>
        </div>
        <ReplacedButton printerId={printerId} part={part} />
      </div>
      <WearBar used={wear.used} lifespan={wear.lifespan} level={wear.level} />
      <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
    </li>
  )
}
