import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { normalizePrinterProfile, type PrinterProfile } from '../../../core/platePlanner'
import { savePlatePlannerProfiles } from '../../../server/fns'
import { platePlannerQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

type CustomPrinter = {
  name: string
  widthMm: string
  depthMm: string
  heightMm: string
}

const emptyCustomPrinter = (): CustomPrinter => ({ name: '', widthMm: '', depthMm: '', heightMm: '' })

export function PrintersPane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const { data } = useQuery(platePlannerQuery())
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [custom, setCustom] = useState<CustomPrinter>(emptyCustomPrinter)
  const callSave = useServerFn(savePlatePlannerProfiles)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ next }: { next: PrinterProfile[]; previous: PrinterProfile[] }) => callSave({ data: { profiles: next } }),
    onSuccess: async (_result, { next }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plate-planner'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      if (onboarding) onSaved?.()
      else toast.success(next.length ? 'Resin printers updated.' : 'Printer list cleared. Planner is hidden.')
    },
    onError: (error, { previous }) => {
      setProfiles(previous)
      toast.error(error.message || 'Could not update resin printers.')
    },
  })

  useEffect(() => {
    if (data) setProfiles((data.profiles ?? []).map((profile) => normalizePrinterProfile(profile)))
  }, [data])

  if (!data) return <SettingsHeader title="Resin printers" description="Loading printer settings…" />

  const updateProfiles = (next: PrinterProfile[]) => {
    const previous = profiles
    setProfiles(next)
    if (!onboarding) mutation.mutate({ next, previous })
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
        <div>
          <h3 className="font-heading text-xl font-semibold">Add your resin printers</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Enter each printer's usable build volume. PrintHub keeps this configuration inside your self-hosted installation.
          </p>
        </div>
      ) : (
        <SettingsHeader
          title="Resin printers"
          description="Configure the resin printers available for request assignment and private plate planning."
        >
          {profiles.length > 0 && (
            <Link to="/planner" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}>
              Open planner
            </Link>
          )}
        </SettingsHeader>
      )}

      <SettingsSection
        title="Your resin printers"
        description={
          profiles.length
            ? `${profiles.length} resin printer${profiles.length === 1 ? '' : 's'} configured.`
            : 'No printers configured. Requests remain unassigned and the planner stays hidden.'
        }
      >
        {profiles.length > 0 && (
          <div className="divide-y rounded-lg border">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center gap-3 p-3 max-sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{profile.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="outline">Resin</Badge>
                    <Badge variant="secondary">
                      {formatDimension(profile.widthMm)} × {formatDimension(profile.depthMm)} × {formatDimension(profile.heightMm)} mm
                    </Badge>
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
        title="Add a resin printer"
        description="Use the dimensions from the manufacturer's specification sheet or your slicer profile."
      >
        <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2 max-sm:grid-cols-1">
          <Field className="max-md:col-span-2 max-sm:col-span-1">
            <FieldLabel htmlFor="custom-printer-name">Name</FieldLabel>
            <Input
              id="custom-printer-name"
              placeholder="Saturn 4 Ultra"
              value={custom.name}
              onChange={(event) => setCustom((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <DimensionField label="Width" value={custom.widthMm} onChange={(widthMm) => setCustom((current) => ({ ...current, widthMm }))} />
          <DimensionField label="Depth" value={custom.depthMm} onChange={(depthMm) => setCustom((current) => ({ ...current, depthMm }))} />
          <DimensionField
            label="Height"
            value={custom.heightMm}
            onChange={(heightMm) => setCustom((current) => ({ ...current, heightMm }))}
          />
        </div>
        <FieldDescription>Only usable resin build volume is stored; no printer account or cloud connection is required.</FieldDescription>
        <FieldError>{custom.name || custom.widthMm || custom.depthMm || custom.heightMm ? customError : ''}</FieldError>
        <div>
          <Button type="button" variant="outline" disabled={!!customError || mutation.isPending} onClick={addCustomPrinter}>
            <Plus /> Add resin printer
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

  return <SettingsPage>{content}</SettingsPage>
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

function profileFromCustom(custom: CustomPrinter): PrinterProfile | undefined {
  if (customValidationError(custom)) return undefined
  return {
    id: crypto.randomUUID(),
    name: custom.name.trim(),
    widthMm: Number(custom.widthMm),
    depthMm: Number(custom.depthMm),
    heightMm: Number(custom.heightMm),
    spacingMm: 5,
    supportMarginMm: 4,
    adhesionMarginMm: 2,
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
