import { useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { consumablesOfKind, type Consumable, type FilamentColour } from '../../../core/consumables'
import { filamentConsumableName, type FilamentPreset } from '../../../core/filamentPresets'
import {
  ORDER_VENDOR_BRANDS,
  matchOrderLine,
  orderRestock,
  type OrderLineMatch,
  type OrderRestockChoice,
} from '../../../core/orders/orderRestock'
import { parseOrderEmail, type OrderLine, type ParsedOrder } from '../../../core/orders/orderEmail'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, type PriceCalculatorCurrency } from '../../../core/priceCalculator'
import { restockFromOrder, undoUsage } from '../../../server/fns'
import { createId } from '../../id'
import { useI18n } from '../../i18n'
import { catalogueQuery, priceCalculatorSettingsQuery, stockQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { ColourSwatch } from '../ColourSwatch'
import { DialogShell } from '../DialogShell'
import { formatMoney } from '../priceCalculator/format'
import { formatQuantity } from './ConsumableStock'

const SKIP = 'skip'
const ADD = 'add'

type Row = { key: string; line: OrderLine; match: OrderLineMatch }

/**
 * Restocks from a pasted order confirmation. The email is read here and dropped once read, so it never leaves the
 * browser; each line it lists is matched to the library for someone to confirm or change before anything is stored.
 */
export function OrderRestockDialog({
  workspaceSlug,
  consumables,
  onClose,
}: {
  workspaceSlug: string
  consumables: Consumable[]
  onClose: () => void
}) {
  const copy = useI18n().t.settings.consumables.order
  const [order, setOrder] = useState<ParsedOrder>()
  return order ? (
    <OrderReview
      workspaceSlug={workspaceSlug}
      consumables={consumables}
      order={order}
      onBack={() => setOrder(undefined)}
      onClose={onClose}
    />
  ) : (
    <DialogShell onClose={onClose} title={copy.title} description={copy.description}>
      <OrderPaste onRead={setOrder} />
    </DialogShell>
  )
}

function OrderPaste({ onRead }: { onRead: (order: ParsedOrder) => void }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.order
  const id = useId()
  const [pasted, setPasted] = useState('')
  const [missing, setMissing] = useState(false)
  const shops = new Intl.ListFormat(locale, { type: 'disjunction' }).format(Object.values(ORDER_VENDOR_BRANDS))
  const read = (text: string) => {
    const order = parseOrderEmail(text)
    if (order) onRead(order)
    else setMissing(text.trim() !== '')
  }
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{copy.pasteLabel}</FieldLabel>
      <Textarea
        id={id}
        className="max-h-[45dvh] min-h-40 font-mono text-xs"
        spellCheck={false}
        aria-invalid={missing || undefined}
        value={pasted}
        onChange={(event) => {
          setPasted(event.target.value)
          setMissing(false)
        }}
        onPaste={(event) => {
          const html = event.clipboardData.getData('text/html')
          const text = html || event.clipboardData.getData('text/plain')
          if (!parseOrderEmail(text)) return
          event.preventDefault()
          read(text)
        }}
      />
      <FieldDescription>
        {copy.pasteHint} {copy.shops(shops)}
      </FieldDescription>
      {missing && <FieldError>{copy.notFound(shops)}</FieldError>}
      <Button type="button" className="mt-1 justify-self-end" disabled={!pasted.trim()} onClick={() => read(pasted)}>
        {copy.read}
      </Button>
    </Field>
  )
}

function OrderReview({
  workspaceSlug,
  consumables,
  order,
  onBack,
  onClose,
}: {
  workspaceSlug: string
  consumables: Consumable[]
  order: ParsedOrder
  onBack: () => void
  onClose: () => void
}) {
  const copy = useI18n().t.settings.consumables.order
  const queryClient = useQueryClient()
  const currency =
    useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const levels = useQuery(stockQuery(workspaceSlug)).data?.stock
  const catalogue = useQuery(catalogueQuery('filaments')).data
  const managed = useMemo(() => new Set(levels?.flatMap((level) => (level.spoolman ? [level.consumableId] : []))), [levels])
  const rows = useMemo<Row[] | undefined>(
    () =>
      catalogue &&
      levels &&
      order.lines.map((line, index) => ({
        key: `line-${index}`,
        line,
        match: matchOrderLine(order.vendor, line, consumables, catalogue, managed),
      })),
    [catalogue, levels, order, consumables, managed],
  )
  const priced = order.currency === currency
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [updatePrices, setUpdatePrices] = useState(false)
  const target = (row: Row) => targets[row.key] ?? defaultTarget(row, priced)
  const choices = (rows ?? []).flatMap((row): OrderRestockChoice[] => {
    const chosen = target(row)
    if (chosen === SKIP || row.match.kind === 'spoolman') return []
    if (chosen === ADD) return row.match.kind === 'catalogue' ? [{ line: row.line, add: row.match }] : []
    return [{ line: row.line, consumableId: chosen }]
  })
  const input = catalogue && orderRestock(order, choices, { consumables, catalogue, currency, updatePrices, newId: createId })
  const callRestock = useServerFn(restockFromOrder)
  const callUndo = useServerFn(undoUsage)
  const restock = useMutation({
    mutationFn: () => callRestock({ data: { workspaceSlug, ...input! } }),
    onSuccess: async ({ transactionId }) => {
      await invalidateQueries(queryClient, 'stock', 'usage', 'consumables')
      const count = input!.restocks.length
      toast(copy.done(count), {
        ...((input!.added.length > 0 || input!.prices.length > 0) && { description: copy.undoKeeps }),
        ...(transactionId && {
          action: {
            label: copy.undo,
            onClick: () =>
              void callUndo({ data: { workspaceSlug, transactionId } }).then(() => invalidateQueries(queryClient, 'stock', 'usage')),
          },
        }),
      })
      onClose()
    },
  })
  const count = input?.restocks.length ?? 0
  return (
    <DialogShell
      onClose={onClose}
      title={copy.title}
      description={copy.summary(ORDER_VENDOR_BRANDS[order.vendor], order.lines.length)}
      className="sm:max-w-[640px]"
      footer={
        <>
          <Button type="button" variant="ghost" className="sm:mr-auto" onClick={onBack}>
            {copy.pasteAnother}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button type="button" disabled={!count || restock.isPending} onClick={() => restock.mutate()}>
            {restock.isPending && <Spinner />} {copy.submit(count)}
          </Button>
        </>
      }
    >
      {!rows || !catalogue ? (
        <Spinner />
      ) : (
        <>
          {/* Order lines can carry an address line the parser mistook for a product, so replays never record them. */}
          <ul className="ph-no-capture grid divide-y rounded-md border" data-order-lines>
            {rows.map((row) => (
              <OrderLineRow
                key={row.key}
                row={row}
                catalogue={catalogue}
                consumables={consumables}
                currency={order.currency}
                priced={priced}
                value={target(row)}
                onChange={(value) => setTargets((current) => ({ ...current, [row.key]: value }))}
              />
            ))}
          </ul>
          {priced ? (
            <label className="flex items-start gap-2.5 text-sm" htmlFor="order-update-prices">
              <Checkbox id="order-update-prices" className="mt-0.5" checked={updatePrices} onCheckedChange={setUpdatePrices} />
              <span className="grid gap-0.5">
                {copy.updatePrices}
                <span className="text-xs text-muted-foreground">{copy.updatePricesHint}</span>
              </span>
            </label>
          ) : (
            order.currency && <p className="text-xs text-muted-foreground">{copy.otherCurrency(order.currency)}</p>
          )}
          {restock.error != null && <FieldError>{copy.error}</FieldError>}
        </>
      )}
    </DialogShell>
  )
}

/** A matched line restocks its match; a catalogue colour joins the list when the order prices it; anything else waits for a pick. */
function defaultTarget({ line, match }: Row, priced: boolean) {
  if (match.kind === 'library') return match.consumableId
  if (match.kind === 'catalogue' && priced && line.linePrice !== undefined) return ADD
  return SKIP
}

function OrderLineRow({
  row,
  catalogue,
  consumables,
  currency,
  priced,
  value,
  onChange,
}: {
  row: Row
  catalogue: readonly FilamentPreset[]
  consumables: Consumable[]
  currency?: PriceCalculatorCurrency
  priced: boolean
  value: string
  onChange: (value: string) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables.order
  const id = useId()
  const { line, match } = row
  const filaments = consumablesOfKind(consumables, 'filament')
  const addable = match.kind === 'catalogue' && priced && line.linePrice !== undefined
  const addName = match.kind === 'catalogue' ? catalogueName(catalogue, match.presetId, match.colour) : undefined
  const options = [
    ...(addable && addName ? [{ value: ADD, label: copy.add(addName), hex: match.colour.hex }] : []),
    ...filaments.map((filament) => ({ value: filament.id, label: filament.name, hex: filament.colour?.hex })),
    { value: SKIP, label: copy.skip, hex: undefined },
  ]
  const chosen = options.find((option) => option.value === value)
  const hex = chosen?.hex ?? (match.kind === 'catalogue' ? match.colour.hex : undefined)
  const title = [line.product, line.colour?.name].filter(Boolean).join(' · ')
  const details = [
    line.form && copy.form[line.form],
    line.grams ? `${line.quantity} × ${formatQuantity(line.grams, 'g', locale)}` : `× ${line.quantity}`,
    line.linePrice !== undefined && currency && formatMoney(line.linePrice, currency, locale),
  ].filter(Boolean)
  return (
    <li className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-start gap-2">
        {hex && <ColourSwatch hex={hex} className="mt-1" />}
        <div className="min-w-0">
          <p className="text-sm font-medium [overflow-wrap:anywhere]">
            {title}
            {line.colour?.code && <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">{line.colour.code}</span>}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{details.join(' · ')}</p>
        </div>
      </div>
      {match.kind === 'spoolman' ? (
        <p className="text-xs text-muted-foreground">
          {copy.spoolman}{' '}
          <Link to="/settings/$section" params={{ section: 'spoolman' }} className="underline underline-offset-2">
            {copy.spoolmanLink}
          </Link>
        </p>
      ) : (
        <Field className="min-w-0 gap-1">
          <FieldLabel htmlFor={id} className="sr-only">
            {copy.target(title)}
          </FieldLabel>
          <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
            <SelectTrigger className="w-full min-w-0" id={id}>
              <SelectValue>
                {chosen?.hex && <ColourSwatch hex={chosen.hex} />}
                <span className="truncate">{value === ADD ? copy.addShort : chosen?.label}</span>
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
          {value === SKIP && match.kind === 'unmatched' && <FieldDescription className="text-xs">{copy.unmatched}</FieldDescription>}
          {value === SKIP && match.kind === 'catalogue' && !addable && (
            <FieldDescription className="text-xs">{copy.needsPrice}</FieldDescription>
          )}
        </Field>
      )}
    </li>
  )
}

function catalogueName(catalogue: readonly FilamentPreset[], presetId: string, colour: FilamentColour) {
  const preset = catalogue.find(({ id }) => id === presetId)
  return preset ? filamentConsumableName(preset, colour) : colour.name
}
