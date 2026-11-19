import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  consumablesOfKind,
  partCostPerHour,
  partCostPerPlate,
  type Consumable,
  type FilamentConsumable,
  type PartConsumable,
  type ResinConsumable,
} from '../../../core/consumables'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../../../core/priceCalculator'
import { getResinPreset, RESIN_PRESETS } from '../../../core/resinPresets'
import { PRINT_TYPES } from '../../../core/types'
import { saveConsumables } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { consumablesQuery, priceCalculatorSettingsQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { FilterCombobox } from '../FilterCombobox'
import { NumberInput } from '../priceCalculator/fields'
import { currencySymbol, formatMoney } from '../priceCalculator/format'
import { QueryState } from '../QueryState'
import { PageHeader, SettingsActions, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const resinOptions = RESIN_PRESETS.map((preset) => ({ value: preset.id, label: `${preset.brand} ${preset.name}` }))

export function ConsumablesPane() {
  const workspaceSlug = useWorkspaceSlug()
  const copy = useI18n().t.settings.consumables
  const query = useQuery(consumablesQuery(workspaceSlug))
  if (!query.data) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }
  return <LoadedConsumablesPane workspaceSlug={workspaceSlug} saved={query.data.consumables} />
}

function LoadedConsumablesPane({ workspaceSlug, saved }: { workspaceSlug: string; saved: Consumable[] }) {
  const { t, locale } = useI18n()
  const copy = t.settings.consumables
  const currency =
    useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency ?? DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const symbol = currencySymbol(currency, locale)
  const money = (value: number) => formatMoney(value, currency, locale)
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const callSave = useServerFn(saveConsumables)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: (stored) => queryClient.setQueryData(consumablesQuery(workspaceSlug).queryKey, stored),
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const valid = draft.every(validConsumable)
  const update = (next: Consumable) => setDraft((current) => current.map((item) => (item.id === next.id ? next : item)))
  const remove = (id: string) => setDraft((current) => current.filter((item) => item.id !== id))
  const add = (item: Consumable) => setDraft((current) => [...current, item])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.mutate({ data: { workspaceSlug, consumables: draft } })
  }
  return (
    <SettingsPage>
      <UnsavedChangesGuard dirty={dirty} />
      <PageHeader title={copy.title} description={copy.description} />
      <form className="flex flex-col gap-6" onSubmit={submit}>
        <ConsumableSection
          title={copy.resins.title}
          description={copy.resins.description}
          empty={copy.resins.empty}
          addLabel={copy.resins.add}
          onAdd={() => add({ id: crypto.randomUUID(), kind: 'resin', name: '', pricePerLitre: 50, densityGramsPerMl: 1.1 })}
        >
          {consumablesOfKind(draft, 'resin').map((resin) => (
            <ResinRow key={resin.id} resin={resin} symbol={symbol} onChange={update} onRemove={() => remove(resin.id)} />
          ))}
        </ConsumableSection>
        <ConsumableSection
          title={copy.filaments.title}
          description={copy.filaments.description}
          empty={copy.filaments.empty}
          addLabel={copy.filaments.add}
          onAdd={() => add({ id: crypto.randomUUID(), kind: 'filament', name: '', pricePerKg: 25 })}
        >
          {consumablesOfKind(draft, 'filament').map((filament) => (
            <FilamentRow key={filament.id} filament={filament} symbol={symbol} onChange={update} onRemove={() => remove(filament.id)} />
          ))}
        </ConsumableSection>
        <ConsumableSection
          title={copy.parts.title}
          description={copy.parts.description}
          empty={copy.parts.empty}
          addLabel={copy.parts.add}
          onAdd={() =>
            add({ id: crypto.randomUUID(), kind: 'part', name: '', printType: 'resin', price: 0, lifespan: 100, lifespanUnit: 'plates' })
          }
        >
          {consumablesOfKind(draft, 'part').map((part) => (
            <PartRow key={part.id} part={part} symbol={symbol} money={money} onChange={update} onRemove={() => remove(part.id)} />
          ))}
        </ConsumableSection>
        <SettingsActions>
          <Button type="submit" disabled={!dirty || !valid || mutation.isPending}>
            {mutation.isPending && <Spinner />} {copy.save}
          </Button>
          {dirty && (
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setDraft(saved)}>
              {copy.discard}
            </Button>
          )}
          {mutation.error != null && <FieldError>{copy.saveError}</FieldError>}
        </SettingsActions>
      </form>
    </SettingsPage>
  )
}

function ConsumableSection({
  title,
  description,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  title: string
  description: string
  empty: string
  addLabel: string
  onAdd: () => void
  children: ReactNode[]
}) {
  return (
    <SettingsSection title={title} description={description}>
      {children.length ? <div className="grid gap-3">{children}</div> : <p className="text-sm text-muted-foreground">{empty}</p>}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
    </SettingsSection>
  )
}

function Row({ name, children, onRemove }: { name: string; children: ReactNode; onRemove: () => void }) {
  const copy = useI18n().t.settings.consumables
  return (
    <div className="relative grid min-w-0 gap-3 rounded-md border border-border/70 p-3 sm:grid-cols-2">
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={copy.remove(name)}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  )
}

function NameField({ id, value, onChange }: { id: string; value: string; onChange: (name: string) => void }) {
  const copy = useI18n().t.settings.consumables
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={`${id}-name`}>{copy.name}</FieldLabel>
      <Input id={`${id}-name`} value={value} maxLength={120} required onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function AmountField({
  id,
  label,
  value,
  min,
  description,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  description?: string
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NumberInput id={id} value={value} min={min} step="any" required onChange={onChange} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

function ResinRow({
  resin,
  symbol,
  onChange,
  onRemove,
}: {
  resin: ResinConsumable
  symbol: string
  onChange: (resin: ResinConsumable) => void
  onRemove: () => void
}) {
  const copy = useI18n().t.settings.consumables.resins
  return (
    <Row name={resin.name} onRemove={onRemove}>
      <NameField id={resin.id} value={resin.name} onChange={(name) => onChange({ ...resin, name })} />
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor={`${resin.id}-preset`}>{copy.preset}</FieldLabel>
        <FilterCombobox
          id={`${resin.id}-preset`}
          value={resin.resinPresetId}
          options={resinOptions}
          placeholder={copy.presetSearch}
          emptyLabel={copy.presetEmpty}
          onChange={(resinPresetId) => {
            const preset = getResinPreset(resinPresetId)
            onChange({
              ...resin,
              resinPresetId: preset?.id,
              name: resin.name || (preset ? `${preset.brand} ${preset.name}` : ''),
              densityGramsPerMl: preset?.densityGramsPerMl ?? resin.densityGramsPerMl,
            })
          }}
        />
      </Field>
      <AmountField
        id={`${resin.id}-price`}
        label={copy.price(symbol)}
        value={resin.pricePerLitre}
        min={0.01}
        onChange={(pricePerLitre) => onChange({ ...resin, pricePerLitre })}
      />
      <AmountField
        id={`${resin.id}-density`}
        label={copy.density}
        value={resin.densityGramsPerMl}
        min={0.01}
        onChange={(densityGramsPerMl) => onChange({ ...resin, densityGramsPerMl })}
      />
    </Row>
  )
}

function FilamentRow({
  filament,
  symbol,
  onChange,
  onRemove,
}: {
  filament: FilamentConsumable
  symbol: string
  onChange: (filament: FilamentConsumable) => void
  onRemove: () => void
}) {
  const copy = useI18n().t.settings.consumables.filaments
  return (
    <Row name={filament.name} onRemove={onRemove}>
      <NameField id={filament.id} value={filament.name} onChange={(name) => onChange({ ...filament, name })} />
      <AmountField
        id={`${filament.id}-price`}
        label={copy.price(symbol)}
        value={filament.pricePerKg}
        min={0.01}
        onChange={(pricePerKg) => onChange({ ...filament, pricePerKg })}
      />
    </Row>
  )
}

function PartRow({
  part,
  symbol,
  money,
  onChange,
  onRemove,
}: {
  part: PartConsumable
  symbol: string
  money: (value: number) => string
  onChange: (part: PartConsumable) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const copy = t.settings.consumables.parts
  const printTypes = PRINT_TYPES.map((value) => ({ value, label: t.calculator.job[value] }))
  const units = (['plates', 'hours'] as const).map((value) => ({ value, label: copy.units[value] }))
  const cost = part.lifespanUnit === 'plates' ? copy.perPlate(money(partCostPerPlate(part))) : copy.perHour(money(partCostPerHour(part)))
  return (
    <Row name={part.name} onRemove={onRemove}>
      <NameField id={part.id} value={part.name} onChange={(name) => onChange({ ...part, name })} />
      <Field>
        <FieldLabel htmlFor={`${part.id}-print-type`}>{copy.printType}</FieldLabel>
        <Select items={printTypes} value={part.printType} onValueChange={(printType) => printType && onChange({ ...part, printType })}>
          <SelectTrigger className="w-full" id={`${part.id}-print-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {printTypes.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <AmountField
        id={`${part.id}-price`}
        label={copy.price(symbol)}
        value={part.price}
        min={0}
        onChange={(price) => onChange({ ...part, price })}
      />
      <AmountField
        id={`${part.id}-lifespan`}
        label={copy.lifespan}
        value={part.lifespan}
        min={1}
        description={cost}
        onChange={(lifespan) => onChange({ ...part, lifespan })}
      />
      <Field>
        <FieldLabel htmlFor={`${part.id}-unit`}>{copy.lifespanUnit}</FieldLabel>
        <Select
          items={units}
          value={part.lifespanUnit}
          onValueChange={(lifespanUnit) => lifespanUnit && onChange({ ...part, lifespanUnit })}
        >
          <SelectTrigger className="w-full" id={`${part.id}-unit`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {units.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Row>
  )
}

function validConsumable(consumable: Consumable) {
  if (!consumable.name.trim()) return false
  if (consumable.kind === 'resin') return consumable.pricePerLitre > 0 && consumable.densityGramsPerMl > 0
  if (consumable.kind === 'filament') return consumable.pricePerKg > 0
  return consumable.price >= 0 && consumable.lifespan > 0
}
