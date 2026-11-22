import { useRef, useState } from 'react'
import { ChevronRight, Plus, Store as StoreIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Consumable } from '../../../core/consumables'
import { activeItems } from '../../../core/inventory'
import { PRICE_CALCULATOR_CURRENCIES, type PriceCalculatorCurrency } from '../../../core/priceCalculator'
import { validSourceUrl } from '../../../core/request'
import { shippingShare, storeCurrency, type Store } from '../../../core/stores'
import { useI18n } from '../../i18n'
import { createId } from '../../id'
import { useInventory } from '../../inventory'
import { useAutosave } from '../../useAutosave'
import { AutosaveStatus } from '../AutosaveStatus'
import { DialogShell } from '../DialogShell'
import { currencyLabel, currencySymbol, formatMoney } from '../priceCalculator/format'
import { ArchivedInventory } from './ArchivedInventory'
import { SettingsSection } from './SettingsLayout'

/** The stores consumables are bought from, each opening a dialog that saves as it is edited, then the archived ones. */
export function StoresSection({
  stores,
  consumables,
  currency,
}: {
  stores: Store[]
  consumables: Consumable[]
  /** The workspace currency, which a store without its own prices in. */
  currency: PriceCalculatorCurrency
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const { mutation, save, setArchived, remove } = useInventory('stores')
  const [editing, setEditing] = useState<Store | null>(null)
  const active = activeItems(stores)
  const failed = () => void toast.error(copy.notSaved)
  const archive = (store: Store) => {
    setEditing(null)
    setArchived(store.id, true).then(
      () =>
        toast(copy.archivedItem(store.name), {
          action: { label: copy.undo, onClick: () => void setArchived(store.id, false).catch(failed) },
        }),
      failed,
    )
  }
  const items = (store: Store) => activeItems(consumables).filter(({ storeId }) => storeId === store.id).length
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
  const shipping = (store: Store) => {
    const money = (value: number) => formatMoney(value, storeCurrency(store, currency), locale)
    const share = shippingShare(store)
    return [
      store.currency && store.currency !== currency && store.currency,
      store.shippingCost === undefined ? copy.stores.noShipping : copy.stores.shipping(money(store.shippingCost)),
      store.freeShippingOver !== undefined && copy.stores.freeOver(money(store.freeShippingOver)),
      share > 0 && copy.stores.spread(percent.format(share)),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <>
      <SettingsSection
        layout="stacked"
        title={active.length ? `${copy.stores.title} · ${active.length}` : copy.stores.title}
        description={copy.stores.description}
        action={
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing({ id: createId(), name: '' })}>
            <Plus /> <span className="max-sm:sr-only">{copy.stores.add}</span>
          </Button>
        }
      >
        {active.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-lg border bg-card">
            {active.map((store) => (
              <li key={store.id}>
                <button
                  type="button"
                  aria-label={copy.stores.edit(store.name)}
                  className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                  onClick={() => setEditing(store)}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <StoreIcon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">{store.name}</span>
                    <span className="block text-xs text-muted-foreground">{shipping(store)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground max-sm:hidden">
                    {copy.stores.itemCount(items(store))}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.stores.empty}</p>
        )}
      </SettingsSection>
      <ArchivedInventory
        kind="stores"
        title={copy.stores.archived.title}
        description={copy.stores.archived.description}
        restoreLabel={copy.stores.archived.restore}
        items={stores.filter((store) => store.archived).map((store) => ({ id: store.id, name: store.name, detail: shipping(store) }))}
        pending={mutation.isPending}
        onRestore={(id) => void setArchived(id, false).catch(failed)}
        onDelete={remove}
      />
      {editing && (
        <StoreDialog
          key={editing.id}
          store={editing}
          isNew={!stores.some(({ id }) => id === editing.id)}
          currency={currency}
          onSave={save}
          onArchive={() => archive(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/**
 * One store's name, website, currency, and shipping, saved as it is edited; a new one is created once it has a name,
 * and one in its own currency once it has a rate.
 */
function StoreDialog({
  store,
  isNew,
  currency,
  onSave,
  onArchive,
  onClose,
}: {
  store: Store
  isNew: boolean
  currency: PriceCalculatorCurrency
  onSave: (store: Store) => Promise<void>
  onArchive: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const [draft, setDraft] = useState(store)
  const [url, setUrl] = useState(store.url ?? '')
  const urlValid = url.trim() === '' || validSourceUrl(url.trim())
  const valid = draft.name.trim() !== '' && urlValid && (!draft.currency || draft.exchangeRate !== undefined)
  const autosave = useAutosave({ value: draft, valid, save: onSave })
  const nameField = useRef<HTMLInputElement>(null)
  const [initialFocus] = useState(() => (isNew ? nameField : undefined))
  const close = async () => {
    if (!valid || (await autosave.flush())) onClose()
  }
  const own = storeCurrency(draft, currency)
  const symbol = currencySymbol(own, locale)
  const currencies = [
    { value: NO_CURRENCY, label: copy.stores.workspaceCurrency(currency) },
    ...PRICE_CALCULATOR_CURRENCIES.filter((code) => code !== currency).map((code) => ({ value: code, label: currencyLabel(code, locale) })),
  ]
  const amount = (key: 'shippingCost' | 'freeShippingOver' | 'usualOrder' | 'exchangeRate', label: string, hint: string) => {
    const id = `store-${key}`
    const value = draft[key]
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          className="tabular-nums"
          value={value ?? ''}
          onChange={(event) => {
            const entered = event.target.valueAsNumber
            const accepted = Number.isFinite(entered) && (key === 'shippingCost' ? entered >= 0 : entered > 0)
            setDraft({ ...draft, [key]: accepted ? entered : undefined })
          }}
        />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
    )
  }
  return (
    <DialogShell
      onClose={() => void close()}
      title={draft.name.trim() || copy.stores.newTitle}
      status={<AutosaveStatus status={autosave.status} onRetry={() => void autosave.retry()} />}
      initialFocus={initialFocus}
      focusDialog={!initialFocus}
      contentClassName="space-y-5"
      footer={
        <>
          {!isNew && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive sm:mr-auto"
              onClick={() => void autosave.flush().then((saved) => saved && onArchive())}
            >
              {copy.archive}
            </Button>
          )}
          <Button type="button" onClick={() => void close()}>
            {t.common.done}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="store-name">{copy.name}</FieldLabel>
        <Input
          id="store-name"
          ref={nameField}
          value={draft.name}
          maxLength={100}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </Field>
      <Field data-invalid={!urlValid || undefined}>
        <FieldLabel htmlFor="store-url">{copy.stores.url}</FieldLabel>
        <Input
          id="store-url"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          maxLength={2_000}
          aria-invalid={!urlValid || undefined}
          onChange={(event) => {
            const next = event.target.value
            setUrl(next)
            setDraft({ ...draft, url: next.trim() && validSourceUrl(next.trim()) ? next.trim() : undefined })
          }}
        />
        {urlValid ? <FieldDescription>{copy.stores.urlHint}</FieldDescription> : <FieldError>{copy.stores.urlInvalid}</FieldError>}
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="store-currency">{copy.stores.currency}</FieldLabel>
          <Select
            items={currencies}
            value={draft.currency ?? NO_CURRENCY}
            onValueChange={(next) => {
              const code = PRICE_CALCULATOR_CURRENCIES.find((candidate) => candidate === next)
              setDraft({ ...draft, currency: code, exchangeRate: code ? draft.exchangeRate : undefined })
            }}
          >
            <SelectTrigger className="w-full" id="store-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.stores.currencyHint}</FieldDescription>
        </Field>
        {draft.currency && amount('exchangeRate', copy.stores.exchangeRate(draft.currency, currency), copy.stores.exchangeRateHint)}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {amount('shippingCost', copy.stores.shippingCost(symbol), copy.stores.shippingCostHint)}
        {amount('freeShippingOver', copy.stores.freeShippingOver(symbol), copy.stores.freeShippingOverHint)}
        {amount('usualOrder', copy.stores.usualOrder(symbol), copy.stores.usualOrderHint)}
      </div>
    </DialogShell>
  )
}

const NO_CURRENCY = ''
const NO_STORE = ''

/** Which store a consumable is bought from, among those in use and the one it names now. */
export function StoreField({ stores, value, onChange }: { stores: Store[]; value?: string; onChange: (storeId?: string) => void }) {
  const copy = useI18n().t.settings.consumables.stores
  const options = [
    { value: NO_STORE, label: copy.noStore },
    ...stores.filter((store) => !store.archived || store.id === value).map((store) => ({ value: store.id, label: store.name })),
  ]
  return (
    <Field>
      <FieldLabel htmlFor="consumable-store">{copy.boughtFrom}</FieldLabel>
      <Select items={options} value={value ?? NO_STORE} onValueChange={(next) => onChange(next || undefined)}>
        <SelectTrigger className="w-full" id="consumable-store">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}
