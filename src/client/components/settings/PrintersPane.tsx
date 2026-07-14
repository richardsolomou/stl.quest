import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { normalizePrinterProfile, type PrinterProfile } from '../../../core/platePlanner'
import { printerCatalog, printerCatalogLabel, type PrinterCatalogEntry } from '../../../core/printerCatalog'
import type { PrintTechnology } from '../../../core/types'
import { savePlatePlannerProfiles } from '../../../server/fns'
import { platePlannerQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const TECHNOLOGIES = [
  { value: 'fdm', label: 'FDM — filament' },
  { value: 'sla', label: 'SLA — resin' },
] as const

type CustomPrinter = {
  name: string
  technology: PrintTechnology
  widthMm: string
  depthMm: string
  heightMm: string
}

const emptyCustomPrinter = (): CustomPrinter => ({ name: '', technology: 'fdm', widthMm: '', depthMm: '', heightMm: '' })

export function PrintersPane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const { data } = useQuery(platePlannerQuery())
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [catalogId, setCatalogId] = useState<string | null>(null)
  const [custom, setCustom] = useState<CustomPrinter>(emptyCustomPrinter)
  const callSave = useServerFn(savePlatePlannerProfiles)
  const queryClient = useQueryClient()
  const availableCatalog = useMemo(
    () => printerCatalog.filter((printer) => !profiles.some((profile) => profile.catalogId === printer.id)),
    [profiles],
  )
  const mutation = useMutation({
    mutationFn: ({ next }: { next: PrinterProfile[]; previous: PrinterProfile[] }) => callSave({ data: { profiles: next } }),
    onSuccess: async (_result, { next }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plate-planner'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      if (onboarding) onSaved?.()
      else toast.success(next.length ? 'Printers updated.' : 'Printer list cleared. Planner is hidden.')
    },
    onError: (error, { previous }) => {
      setProfiles(previous)
      toast.error(error.message || 'Could not update printers.')
    },
  })

  useEffect(() => {
    if (data) setProfiles((data.profiles ?? []).map((profile) => normalizePrinterProfile(profile)))
  }, [data])

  if (!data) return <SettingsHeader title="Printers" description="Loading printer catalog…" />

  const updateProfiles = (next: PrinterProfile[]) => {
    const previous = profiles
    setProfiles(next)
    if (!onboarding) mutation.mutate({ next, previous })
  }

  const addCatalogPrinter = () => {
    const catalogPrinter = printerCatalog.find((printer) => printer.id === catalogId)
    if (!catalogPrinter) return
    updateProfiles([...profiles, profileFromCatalog(catalogPrinter)])
    setCatalogId(null)
  }

  const addCustomPrinter = () => {
    const profile = profileFromCustom(custom)
    if (!profile) return
    updateProfiles([...profiles, profile])
    setCustom(emptyCustomPrinter())
  }

  const removePrinter = (id: string) => updateProfiles(profiles.filter((profile) => profile.id !== id))
  const customError = customValidationError(custom)

  const content = (
    <>
      {onboarding ? (
        <div className="mb-5">
          <h3 className="font-heading text-xl font-semibold">Which printers do you have?</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose from the catalog, add a custom printer, or continue without one. You can change this later.
          </p>
        </div>
      ) : (
        <SettingsHeader
          title="Printers"
          description="Manage the printers available to requests and the plate planner. Changes save automatically."
        >
          {profiles.length > 0 && (
            <Link to="/planner" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}>
              Open planner
            </Link>
          )}
        </SettingsHeader>
      )}

      <SettingsSection
        title="Your printers"
        description={
          profiles.length
            ? `${profiles.length} printer${profiles.length === 1 ? '' : 's'} configured.`
            : 'No printers configured. New prints remain unassigned and the planner stays hidden.'
        }
      >
        {profiles.length > 0 && (
          <div className="divide-y rounded-lg border">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 p-3 max-sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{profile.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline">{profile.technology.toUpperCase()}</Badge>
                    <Badge variant="secondary">
                      {formatDimension(profile.widthMm)} × {formatDimension(profile.depthMm)} × {formatDimension(profile.heightMm)} mm
                    </Badge>
                    {!profile.catalogId && <Badge variant="outline">Custom</Badge>}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${profile.name}`}
                  disabled={mutation.isPending}
                  onClick={() => removePrinter(profile.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Add from catalog"
        description="Search known printer profiles to fill the technology and build dimensions automatically."
      >
        <div className="flex gap-2 max-sm:flex-col">
          <PrinterCatalogCombobox value={catalogId} options={availableCatalog} onChange={setCatalogId} />
          <Button type="button" disabled={!catalogId || mutation.isPending} onClick={addCatalogPrinter}>
            <Plus /> Add printer
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Add custom printer"
        description="Use this when a printer is missing from the catalog or has modified dimensions."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="custom-printer-name">Name</FieldLabel>
            <Input
              id="custom-printer-name"
              value={custom.name}
              maxLength={100}
              placeholder="Workshop printer"
              onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="custom-printer-technology">Technology</FieldLabel>
            <Select
              items={TECHNOLOGIES}
              value={custom.technology}
              onValueChange={(technology) => technology && setCustom((current) => ({ ...current, technology }))}
            >
              <SelectTrigger id="custom-printer-technology" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TECHNOLOGIES.map((technology) => (
                  <SelectItem key={technology.value} value={technology.value}>
                    {technology.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <DimensionField label="Width" value={custom.widthMm} onChange={(widthMm) => setCustom((current) => ({ ...current, widthMm }))} />
          <DimensionField label="Depth" value={custom.depthMm} onChange={(depthMm) => setCustom((current) => ({ ...current, depthMm }))} />
          <DimensionField
            label="Height"
            value={custom.heightMm}
            onChange={(heightMm) => setCustom((current) => ({ ...current, heightMm }))}
          />
        </div>
        <FieldDescription>Enter the usable build volume in millimeters.</FieldDescription>
        <FieldError>{custom.name || custom.widthMm || custom.depthMm || custom.heightMm ? customError : ''}</FieldError>
        <div>
          <Button type="button" variant="outline" disabled={!!customError || mutation.isPending} onClick={addCustomPrinter}>
            <Plus /> Add custom printer
          </Button>
        </div>
      </SettingsSection>

      {onboarding && (
        <SettingsActions>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate({ next: profiles, previous: profiles })}>
            {profiles.length ? 'Finish setup' : 'Continue without a printer'}
          </Button>
        </SettingsActions>
      )}
    </>
  )

  return onboarding ? content : <SettingsPage>{content}</SettingsPage>
}

function DimensionField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = `custom-printer-${label.toLowerCase()}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          className="pr-10"
          type="number"
          min="0.1"
          max="10000"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">mm</span>
      </div>
    </Field>
  )
}

function PrinterCatalogCombobox({
  value,
  options,
  onChange,
}: {
  value: string | null
  options: PrinterCatalogEntry[]
  onChange: (value: string | null) => void
}) {
  const items = options.map((printer) => ({
    value: printer.id,
    label: `${printerCatalogLabel(printer)} · ${printer.technology.toUpperCase()} · ${formatDimension(printer.widthMm)} × ${formatDimension(printer.depthMm)} × ${formatDimension(printer.heightMm)} mm`,
  }))
  const labels = new Map(items.map((item) => [item.value, item.label]))
  return (
    <Combobox
      value={value}
      onValueChange={onChange}
      items={items.map((item) => item.value)}
      itemToStringLabel={(itemValue) => labels.get(itemValue) ?? itemValue}
    >
      <ComboboxInput className="w-full flex-1" placeholder="Search manufacturer or model…" showClear />
      <ComboboxContent>
        <ComboboxEmpty>No matching printer found.</ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(option: string) => (
              <ComboboxItem key={option} value={option}>
                {labels.get(option)}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function profileFromCatalog(printer: PrinterCatalogEntry): PrinterProfile {
  return {
    id: crypto.randomUUID(),
    name: printerCatalogLabel(printer),
    technology: printer.technology,
    catalogId: printer.id,
    widthMm: printer.widthMm,
    depthMm: printer.depthMm,
    heightMm: printer.heightMm,
    spacingMm: 5,
    supportMarginMm: printer.technology === 'sla' ? 4 : 0,
    adhesionMarginMm: printer.technology === 'sla' ? 2 : 0,
    heightAllowanceMm: 5,
    maxHeightDifferenceMm: 20,
  }
}

function profileFromCustom(custom: CustomPrinter): PrinterProfile | undefined {
  if (customValidationError(custom)) return undefined
  return {
    id: crypto.randomUUID(),
    name: custom.name.trim(),
    technology: custom.technology,
    widthMm: Number(custom.widthMm),
    depthMm: Number(custom.depthMm),
    heightMm: Number(custom.heightMm),
    spacingMm: 5,
    supportMarginMm: custom.technology === 'sla' ? 4 : 0,
    adhesionMarginMm: custom.technology === 'sla' ? 2 : 0,
    heightAllowanceMm: 5,
    maxHeightDifferenceMm: 20,
  }
}

function customValidationError(custom: CustomPrinter) {
  if (!custom.name.trim()) return 'Enter a printer name.'
  const dimensions = [custom.widthMm, custom.depthMm, custom.heightMm].map(Number)
  if (dimensions.some((dimension) => !Number.isFinite(dimension) || dimension <= 0 || dimension > 10_000)) {
    return 'Enter valid width, depth, and height values.'
  }
  return ''
}

function formatDimension(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
