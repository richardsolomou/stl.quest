import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { normalizePrinterProfile, type FdmPrinterProfile, type PrinterProfile, type ResinPrinterProfile } from '../../../core/platePlanner'
import type { PrintTechnology } from '../../../core/types'
import { savePlatePlannerProfiles } from '../../../server/fns'
import { platePlannerQuery } from '../../queries'
import { ConfirmDialog } from '../ConfirmDialog'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const TECHNOLOGIES: { value: PrintTechnology; label: string }[] = [
  { value: 'resin', label: 'Resin' },
  { value: 'fdm', label: 'FDM' },
]

export function PrintersPane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const { data } = useQuery(platePlannerQuery())
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [savedProfiles, setSavedProfiles] = useState<PrinterProfile[]>([])
  const [removeId, setRemoveId] = useState<string | null>(null)
  const dirty = JSON.stringify(profiles) !== JSON.stringify(savedProfiles)
  const dirtyRef = useRef(dirty)
  const storedProfiles = data?.profiles
  dirtyRef.current = dirty
  const callSave = useServerFn(savePlatePlannerProfiles)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (next: PrinterProfile[]) => callSave({ data: { profiles: next } }),
    onSuccess: async (_result, next) => {
      setSavedProfiles(next)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plate-planner'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
      ])
      if (onboarding) onSaved?.()
      else toast.success(next.length ? 'Printers updated.' : 'Printer list cleared. Requests remain safely unassigned.')
    },
    onError: (error) => toast.error(error.message || 'Could not update printers.'),
  })

  useEffect(() => {
    if (!storedProfiles || dirtyRef.current) return
    const next = storedProfiles.map((profile) => normalizePrinterProfile(profile))
    setProfiles(next)
    setSavedProfiles(next)
  }, [storedProfiles])

  const error = useMemo(() => profilesValidationError(profiles), [profiles])
  const removeProfile = profiles.find((profile) => profile.id === removeId)

  if (!data) return <SettingsHeader title="Printers" description="Loading printer settings…" />

  const addPrinter = () => setProfiles((current) => [...current, defaultPrinterProfile(defaultTechnology(current))])
  const removePrinter = (id: string) => {
    setProfiles((current) => current.filter((profile) => profile.id !== id))
    setRemoveId(null)
  }

  const content = (
    <>
      {onboarding ? (
        <div>
          <h3 className="font-heading text-xl font-semibold">Add your printers</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Add resin, FDM, or both. Usable build volumes and planning assumptions stay inside your self-hosted installation.
          </p>
        </div>
      ) : (
        <SettingsHeader
          title="Printers"
          description="Configure the resin and FDM printers available for compatible assignment and private build planning."
        >
          {savedProfiles.length > 0 && (
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
            ? `${profiles.length} printer${profiles.length === 1 ? '' : 's'} configured. Resin and FDM can coexist in one queue.`
            : 'No printers configured. Requests can still be accepted, but assignments and plate planning stay unavailable.'
        }
      >
        <div className="grid gap-3">
          {profiles.map((profile, index) => (
            <PrinterEditor
              key={profile.id}
              profile={profile}
              index={index}
              onChange={(next) => setProfiles((current) => current.map((entry) => (entry.id === profile.id ? next : entry)))}
              onRemove={() => setRemoveId(profile.id)}
            />
          ))}
          <Button type="button" variant="outline" className="justify-self-start" onClick={addPrinter} disabled={mutation.isPending}>
            <Plus /> Add printer
          </Button>
        </div>
      </SettingsSection>

      {!onboarding && <UnsavedChangesGuard dirty={dirty} />}
      <FieldError>{error}</FieldError>
      <FieldDescription>
        Build volumes are fit limits. Planning output still needs technology-appropriate slicing, supports, adhesion, and printer settings.
      </FieldDescription>
      <SettingsActions>
        {onboarding && (
          <Button type="button" variant="ghost" onClick={() => mutation.mutate([])} disabled={mutation.isPending}>
            Continue without a printer
          </Button>
        )}
        {!onboarding && dirty && (
          <Button type="button" variant="ghost" onClick={() => setProfiles(savedProfiles)} disabled={mutation.isPending}>
            Discard changes
          </Button>
        )}
        <Button type="button" onClick={() => mutation.mutate(profiles)} disabled={mutation.isPending || !!error || (!onboarding && !dirty)}>
          {mutation.isPending ? 'Saving…' : onboarding ? 'Save printers and finish' : 'Save changes'}
        </Button>
      </SettingsActions>
    </>
  )

  return (
    <>
      {onboarding ? <div className="flex flex-col gap-5">{content}</div> : <SettingsPage>{content}</SettingsPage>}
      <ConfirmDialog
        open={!!removeProfile}
        title={removeProfile ? `Remove “${removeProfile.name || 'this printer'}”?` : 'Remove printer?'}
        description="Requests assigned to this printer will remain in the queue and become unassigned. Saved planner output for it will no longer be used."
        confirmLabel="Remove printer"
        destructive
        onCancel={() => setRemoveId(null)}
        onConfirm={() => removeId && removePrinter(removeId)}
      />
    </>
  )
}

function PrinterEditor({
  profile,
  index,
  onChange,
  onRemove,
}: {
  profile: PrinterProfile
  index: number
  onChange: (profile: PrinterProfile) => void
  onRemove: () => void
}) {
  const updateCommon = (patch: Partial<Pick<PrinterProfile, 'name' | 'widthMm' | 'depthMm' | 'heightMm' | 'spacingMm'>>) =>
    onChange({ ...profile, ...patch })
  const setTechnology = (technology: PrintTechnology) =>
    onChange(
      defaultPrinterProfile(technology, {
        id: profile.id,
        name: profile.name,
        widthMm: profile.widthMm,
        depthMm: profile.depthMm,
        heightMm: profile.heightMm,
      }),
    )

  return (
    <section className="rounded-lg border bg-card/40 p-4" aria-label={`Printer ${index + 1}`}>
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <Field>
            <FieldLabel htmlFor={`${profile.id}-name`}>Printer name</FieldLabel>
            <Input
              id={`${profile.id}-name`}
              value={profile.name}
              placeholder={profile.technology === 'resin' ? 'Resin printer' : 'FDM printer'}
              maxLength={100}
              onChange={(event) => updateCommon({ name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${profile.id}-technology`}>Technology</FieldLabel>
            <Select items={TECHNOLOGIES} value={profile.technology} onValueChange={(value) => value && setTechnology(value)}>
              <SelectTrigger
                id={`${profile.id}-technology`}
                className="w-full"
                aria-label={`Technology for ${profile.name || `printer ${index + 1}`}`}
              >
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
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mt-6 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${profile.name || `printer ${index + 1}`}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <NumberField
          id={`${profile.id}-width`}
          label="Usable width"
          value={profile.widthMm}
          onChange={(widthMm) => updateCommon({ widthMm })}
        />
        <NumberField
          id={`${profile.id}-depth`}
          label="Usable depth"
          value={profile.depthMm}
          onChange={(depthMm) => updateCommon({ depthMm })}
        />
        <NumberField
          id={`${profile.id}-height`}
          label="Usable height"
          value={profile.heightMm}
          onChange={(heightMm) => updateCommon({ heightMm })}
        />
      </div>

      <details className="mt-4 rounded-md border bg-muted/20 p-3">
        <summary className="cursor-pointer font-medium">
          Planning and material assumptions{' '}
          <Badge variant="outline" className="ml-2">
            {profile.technology === 'resin' ? 'Resin' : 'FDM'}
          </Badge>
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">
          {profile.technology === 'resin'
            ? 'Clearance and height grouping guide conservative plate layouts; they do not replace supports or slicing.'
            : 'Spacing and brim clearance guide bed layouts. Density and filament diameter convert solid model volume into a 100%-solid equivalent.'}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id={`${profile.id}-spacing`}
            label="Model spacing"
            value={profile.spacingMm}
            min={0}
            onChange={(spacingMm) => updateCommon({ spacingMm })}
          />
          {profile.technology === 'resin' ? (
            <ResinFields profile={profile} onChange={onChange} />
          ) : (
            <FdmFields profile={profile} onChange={onChange} />
          )}
        </div>
      </details>
    </section>
  )
}

function ResinFields({ profile, onChange }: { profile: ResinPrinterProfile; onChange: (profile: ResinPrinterProfile) => void }) {
  return (
    <>
      <NumberField
        label="Support clearance"
        value={profile.supportMarginMm}
        min={0}
        onChange={(supportMarginMm) => onChange({ ...profile, supportMarginMm })}
      />
      <NumberField
        label="Adhesion clearance"
        value={profile.adhesionMarginMm}
        min={0}
        onChange={(adhesionMarginMm) => onChange({ ...profile, adhesionMarginMm })}
      />
      <NumberField
        label="Supported height allowance"
        value={profile.heightAllowanceMm}
        min={0}
        onChange={(heightAllowanceMm) => onChange({ ...profile, heightAllowanceMm })}
      />
      <NumberField
        label="Height grouping range"
        value={profile.maxHeightDifferenceMm}
        min={0}
        onChange={(maxHeightDifferenceMm) => onChange({ ...profile, maxHeightDifferenceMm })}
      />
    </>
  )
}

function FdmFields({ profile, onChange }: { profile: FdmPrinterProfile; onChange: (profile: FdmPrinterProfile) => void }) {
  return (
    <>
      <NumberField
        label="Brim clearance"
        value={profile.brimMarginMm}
        min={0}
        onChange={(brimMarginMm) => onChange({ ...profile, brimMarginMm })}
      />
      <NumberField
        label="Filament diameter"
        value={profile.filamentDiameterMm}
        min={0.1}
        step={0.01}
        onChange={(filamentDiameterMm) => onChange({ ...profile, filamentDiameterMm })}
      />
      <NumberField
        label="Material density (g/cm³)"
        value={profile.materialDensityGPerCm3}
        min={0.1}
        step={0.01}
        onChange={(materialDensityGPerCm3) => onChange({ ...profile, materialDensityGPerCm3 })}
      />
    </>
  )
}

function NumberField({
  id,
  label,
  value,
  min = 0.1,
  step = 0.1,
  onChange,
}: {
  id?: string
  label: string
  value: number
  min?: number
  step?: number
  onChange: (value: number) => void
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <Field>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={fieldId}
          type="number"
          inputMode="decimal"
          min={min}
          max={10_000}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {!label.includes('density') && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">mm</span>
        )}
      </div>
    </Field>
  )
}

function defaultTechnology(profiles: PrinterProfile[]): PrintTechnology {
  if (!profiles.length) return 'resin'
  return profiles.every((profile) => profile.technology === 'resin') ? 'fdm' : 'resin'
}

function defaultPrinterProfile(
  technology: PrintTechnology,
  common: Partial<Pick<PrinterProfile, 'id' | 'name' | 'widthMm' | 'depthMm' | 'heightMm'>> = {},
): PrinterProfile {
  const base = {
    id: common.id ?? crypto.randomUUID(),
    name: common.name ?? '',
    technology,
    widthMm: common.widthMm ?? (technology === 'resin' ? 130 : 220),
    depthMm: common.depthMm ?? (technology === 'resin' ? 80 : 220),
    heightMm: common.heightMm ?? (technology === 'resin' ? 160 : 250),
    spacingMm: 5,
  }
  return technology === 'resin'
    ? { ...base, technology, supportMarginMm: 4, adhesionMarginMm: 2, heightAllowanceMm: 5, maxHeightDifferenceMm: 20 }
    : { ...base, technology, brimMarginMm: 0, filamentDiameterMm: 1.75, materialDensityGPerCm3: 1.24 }
}

function profilesValidationError(profiles: PrinterProfile[]) {
  const names = new Set<string>()
  for (const profile of profiles) {
    const name = profile.name.trim()
    if (!name) return 'Give every printer a name.'
    if (names.has(name.toLowerCase())) return 'Printer names must be unique.'
    names.add(name.toLowerCase())
    const numbers = Object.entries(profile).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    if (numbers.some(([, value]) => !Number.isFinite(value) || value < 0)) return `Check the numeric settings for ${name}.`
    if (profile.widthMm <= 0 || profile.depthMm <= 0 || profile.heightMm <= 0) return `${name} needs a positive usable build volume.`
    if (profile.technology === 'fdm' && (profile.filamentDiameterMm <= 0 || profile.materialDensityGPerCm3 <= 0)) {
      return `${name} needs a positive filament diameter and material density.`
    }
  }
  return ''
}
