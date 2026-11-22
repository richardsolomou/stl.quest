import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { consumableUnit, type Consumable, type SupplyUnit } from '../../../core/consumables'
import type { Locale, Messages } from '../../../core/i18n'
import { enteredUnitScale, packSize } from '../../../core/stock'
import type { PrinterProfile } from '../../../core/types'
import type { StockLevel, StockMovementInput, UsageEvent } from '../../../core/usage'
import { recordStockMovement, undoUsage } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { usageQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { formatNumber } from '../priceCalculator/format'

type StockCopy = Messages['settings']['consumables']['stock']
type MovementKind = 'restock' | 'correction' | 'waste'

const RECENT_MOVEMENTS = 5

/** An amount in the unit a person reads it in: litres or millilitres, kilograms or grams, or a bare count. */
export function formatQuantity(amount: number, unit: SupplyUnit, locale: Locale) {
  if (unit === 'item') return formatNumber(amount, locale)
  const [large, small] = unit === 'ml' ? ['L', 'mL'] : ['kg', 'g']
  return Math.abs(amount) >= 1_000 ? `${formatNumber(amount / 1_000, locale)} ${large}` : `${formatNumber(amount, locale, 0)} ${small}`
}

/** An amount of a consumable, counting parts as spares and other items as items. */
export function formatStock(amount: number, consumable: Consumable, locale: Locale, copy: StockCopy) {
  const unit = consumableUnit(consumable)
  if (unit !== 'item') return formatQuantity(amount, unit, locale)
  return (consumable.kind === 'part' ? copy.spares : copy.items)(formatNumber(amount, locale))
}

/** Records stock movements and undoes them, refreshing stock levels and the usage log. */
export function useStockMovements(workspaceSlug: string) {
  const queryClient = useQueryClient()
  const record = useServerFn(recordStockMovement)
  const undo = useServerFn(undoUsage)
  // A replacement resets a part's wear, which printer lifetimes report, so they refresh too without waiting for realtime.
  const refresh = () => invalidateQueries(queryClient, 'stock', 'usage', 'printer-lifetimes')
  return {
    movement: useMutation({
      mutationFn: (input: StockMovementInput) => record({ data: { ...input, workspaceSlug } }),
      onSuccess: refresh,
    }),
    undo: useMutation({
      mutationFn: (transactionId: string) => undo({ data: { workspaceSlug, transactionId } }),
      onSuccess: refresh,
    }),
  }
}

/** How much is on hand, for a consumable's summary line; nothing while its stock is not tracked. */
export function StockSummary({ consumable, level }: { consumable: Consumable; level?: StockLevel }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.stock
  if (!level?.tracked) return null
  if (level.missing) return <span className="font-medium text-destructive">{copy.none}</span>
  return (
    <span className="inline-flex items-center gap-1.5" title={level.low ? copy.low : undefined}>
      {level.low && <LowMarker />}
      {formatStock(level.onHand, consumable, locale, copy)}
      {level.low && <span className="sr-only">{copy.low}</span>}
    </span>
  )
}

/** Running low is a caution, not a fault, so it borrows the printing amber rather than fault red. */
export function LowMarker() {
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-[2px] bg-(--stage-in_progress)" />
}

/** A consumable's stock in its dialog: what is on hand, the three ways to move it, and the latest movements. */
export function StockPanel({
  workspaceSlug,
  consumable,
  level,
  printers,
}: {
  workspaceSlug: string
  /** A saved consumable, as the server checks it exists before moving its stock. */
  consumable: Consumable
  level?: StockLevel
  printers: PrinterProfile[]
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.stock
  const [form, setForm] = useState<MovementKind>()
  const amount = (value: number) => formatStock(value, consumable, locale, copy)
  const tracked = level?.tracked ?? false
  if (level?.spoolman) return <SpoolmanStock level={level} spools={level.spoolman.spools} amount={amount} />
  return (
    <section aria-labelledby="consumable-stock" className="grid gap-3 border-t pt-4">
      <h3 id="consumable-stock" className="text-sm font-medium">
        {copy.title}
      </h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48 text-sm">
          {!tracked ? (
            <p className="text-muted-foreground">{copy.untracked}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-1.5">
              {level?.missing ? (
                <span className="font-semibold text-destructive">{copy.none}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {level?.low && <LowMarker />}
                  {copy.onHand(amount(level?.onHand ?? 0))}
                </span>
              )}
              {level?.low && <span className="text-muted-foreground">· {copy.low}</span>}
              {level?.minimum !== undefined && <span className="text-muted-foreground">· {copy.warnsBelow(amount(level.minimum))}</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['restock', 'correction', 'waste'] as const).map((kind) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant={form === kind ? 'secondary' : 'outline'}
              aria-expanded={form === kind}
              disabled={kind !== 'restock' && !tracked}
              onClick={() => setForm((current) => (current === kind ? undefined : kind))}
            >
              {copy.actions[kind]}
            </Button>
          ))}
        </div>
      </div>
      {form && (
        <StockMovementForm
          key={form}
          workspaceSlug={workspaceSlug}
          consumable={consumable}
          kind={form}
          onHand={level?.onHand ?? 0}
          onDone={() => setForm(undefined)}
        />
      )}
      <RecentMovements workspaceSlug={workspaceSlug} consumable={consumable} printers={printers} />
    </section>
  )
}

/** Stock Spoolman manages: what its spools have left, with nothing to move here. */
function SpoolmanStock({ level, spools, amount }: { level: StockLevel; spools: number; amount: (value: number) => string }) {
  const copy = useI18n().t.settings.consumables.stock
  return (
    <section aria-labelledby="consumable-stock" className="grid gap-2 border-t pt-4">
      <h3 id="consumable-stock" className="text-sm font-medium">
        {copy.title}
      </h3>
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        {level.missing ? (
          <span className="font-semibold text-destructive">{copy.none}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-semibold">
            {level.low && <LowMarker />}
            {copy.onHand(amount(level.onHand))}
          </span>
        )}
        <span className="text-muted-foreground">
          · {copy.spoolman.managed} · {copy.spoolman.spools(spools)}
        </span>
        {level.low && <span className="text-muted-foreground">· {copy.low}</span>}
        {level.minimum !== undefined && <span className="text-muted-foreground">· {copy.warnsBelow(amount(level.minimum))}</span>}
      </p>
      <p className="text-xs text-muted-foreground">
        {copy.spoolman.hint}{' '}
        <Link to="/settings/$section" params={{ section: 'spoolman' }} className="underline underline-offset-2">
          {copy.spoolman.link}
        </Link>
      </p>
    </section>
  )
}

/**
 * One stock movement as a small form. A restock counts packs when the consumable has a pack size, or takes an amount;
 * a count takes what is there now; waste takes what was lost. Amounts are entered in litres, kilograms, or items.
 * It sits inside the page's form, so Enter records the movement instead of submitting the page.
 */
export function StockMovementForm({
  workspaceSlug,
  consumable,
  kind,
  onHand,
  onDone,
  className,
}: {
  workspaceSlug: string
  consumable: Consumable
  kind: MovementKind
  onHand: number
  onDone: () => void
  className?: string
}) {
  const { t, locale } = useI18n()
  const consumables = t.settings.consumables
  const copy = consumables.stock
  const unit = consumableUnit(consumable)
  const scale = enteredUnitScale(unit)
  const unitLabel = consumables.stockUnits[unit]
  const size = kind === 'restock' ? packSize(consumable) : undefined
  // A pack of one item is just an amount of items.
  const pack = size && !(unit === 'item' && size === 1) ? size : undefined
  const [mode, setMode] = useState<'packs' | 'amount'>(pack ? 'packs' : 'amount')
  const [value, setValue] = useState(() =>
    kind === 'restock' && (pack || unit === 'item') ? '1' : kind === 'correction' ? String(round(Math.max(0, onHand) / scale)) : '',
  )
  const { movement } = useStockMovements(workspaceSlug)
  const field = useRef<HTMLInputElement>(null)
  // The form opens from a button, so typing the amount starts straight away.
  useEffect(() => field.current?.focus(), [])
  const entered = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(entered) && (kind === 'correction' ? entered >= 0 : entered > 0)
  const total = mode === 'packs' && pack ? entered * pack : entered * scale
  const input: StockMovementInput =
    kind === 'correction' ? { consumableId: consumable.id, kind, counted: total } : { consumableId: consumable.id, kind, amount: total }
  const submit = () => {
    if (!valid || movement.isPending) return
    movement.mutate(input, { onSuccess: onDone })
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    submit()
  }
  const id = `${consumable.id}-${kind}`
  const label =
    kind === 'restock'
      ? mode === 'packs'
        ? copy.restockLabel
        : copy.amountIn(unitLabel)
      : kind === 'correction'
        ? copy.correctionLabel(unitLabel)
        : copy.wasteLabel(unitLabel)
  return (
    <div className={cn('grid gap-2 rounded-md border bg-muted/30 p-3', className)}>
      {kind === 'restock' && pack && (
        <SegmentedControl
          legend={copy.restockLabel}
          size="xs"
          className="justify-self-start"
          value={mode}
          options={[
            { value: 'packs', label: copy.packs[consumable.kind](formatQuantity(pack, unit, locale)) },
            { value: 'amount', label: unitLabel },
          ]}
          onChange={(next) => {
            setMode(next)
            setValue(next === 'packs' ? '1' : '')
          }}
        />
      )}
      <Field className="gap-1">
        <FieldLabel htmlFor={id} className={cn(kind === 'restock' && mode === 'packs' && 'sr-only')}>
          {label}
        </FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            ref={field}
            className="w-28 tabular-nums"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button type="button" size="sm" disabled={!valid || movement.isPending} onClick={submit}>
            {movement.isPending && <Spinner />} {copy.submit[kind]}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={movement.isPending} onClick={onDone}>
            {copy.cancel}
          </Button>
        </div>
        {kind === 'restock' && mode === 'packs' && valid && (
          <FieldDescription>{copy.adds(formatStock(total, consumable, locale, copy))}</FieldDescription>
        )}
        {kind === 'correction' && <FieldDescription>{copy.correctionHint}</FieldDescription>}
        {movement.error != null && <FieldError>{copy.error}</FieldError>}
      </Field>
    </div>
  )
}

function RecentMovements({
  workspaceSlug,
  consumable,
  printers,
}: {
  workspaceSlug: string
  consumable: Consumable
  printers: PrinterProfile[]
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.stock
  // Estimates of past prints never moved stock, so they are no movement either.
  const events = useQuery(usageQuery(workspaceSlug, { consumableId: consumable.id, limit: RECENT_MOVEMENTS })).data?.events.filter(
    (event) => !event.estimated,
  )
  const { undo } = useStockMovements(workspaceSlug)
  if (!events) return null
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const describe = (event: UsageEvent) =>
    event.kind === 'replace' ? copy.movement.replace(printers.find(({ id }) => id === event.printerId)?.name) : copy.movement[event.kind]
  return (
    <div className="grid gap-1">
      <h5 className="text-xs font-medium text-muted-foreground">{copy.recent}</h5>
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.noMovements}</p>
      ) : (
        <ul className="grid divide-y text-sm">
          {events.map((event) => {
            const label = describe(event)
            const sign = event.kind === 'correction' ? (event.amount < 0 ? '−' : '+') : event.kind === 'restock' ? '+' : '−'
            return (
              <li key={event.id} className="flex min-w-0 items-center gap-3 py-1.5">
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row-reverse sm:items-center sm:justify-end sm:gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-32">{when.format(event.createdAt)}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {sign}
                  {formatStock(Math.abs(event.amount), consumable, locale, copy)}
                </span>
                {event.stage === 'stock' && (
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    aria-label={copy.undoLabel(label)}
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(event.transactionId)}
                  >
                    {copy.undo}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000
}
