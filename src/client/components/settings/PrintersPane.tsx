import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { normalizePrinterProfile } from '../../../core/printers'
import type { PrinterPreset } from '../../../core/printerPresets'
import type { PrinterProfile, PrintType } from '../../../core/types'
import { savePrinterProfiles } from '../../../server/fns'
import { printersQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { ConfirmDialog } from '../ConfirmDialog'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const PRINT_TYPES: { value: PrintType; label: string }[] = [
  { value: 'resin', label: 'Resin' },
  { value: 'filament', label: 'Filament' },
]

export function PrintersPane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const { data } = useQuery(printersQuery(workspaceSlug))
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [savedProfiles, setSavedProfiles] = useState<PrinterProfile[]>([])
  const [removeId, setRemoveId] = useState<string | null>(null)
  const dirty = JSON.stringify(profiles) !== JSON.stringify(savedProfiles)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const callSave = useServerFn(savePrinterProfiles)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (next: PrinterProfile[]) => callSave({ data: { workspaceSlug, profiles: next } }),
    onSuccess: async (_result, next) => {
      setSavedProfiles(next)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['printers'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
        queryClient.invalidateQueries({ queryKey: ['requests'] }),
      ])
      if (onboarding) onSaved?.()
      else toast.success(next.length ? 'Printers updated.' : 'Printer list cleared. Requests remain safely unassigned.')
    },
    onError: (error) => toast.error(error.message || 'Could not update printers.'),
  })

  useEffect(() => {
    if (!data || dirtyRef.current) return
    const next = data.profiles.map(normalizePrinterProfile)
    setProfiles(next)
    setSavedProfiles(next)
  }, [data])

  const error = useMemo(() => profilesValidationError(profiles), [profiles])
  const removeProfile = profiles.find((profile) => profile.id === removeId)
  const addCustomPrinter = () => setProfiles((current) => [...current, defaultPrinterProfile(defaultPrintType(current))])
  const addPresetPrinter = (preset: PrinterPreset) => setProfiles((current) => [...current, profileFromPreset(preset)])

  if (!data) return <SettingsHeader title="Printers" description="Loading printer settings…" />

  const content = (
    <>
      {onboarding ? (
        <div>
          <h3 className="font-heading text-xl font-semibold">Add your printers</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Add the machines that operators can assign work to. Slicing and build preparation stay in your slicer.
          </p>
        </div>
      ) : (
        <SettingsHeader title="Printers" description="Manage the machines available for print assignment." />
      )}

      <SettingsSection
        title="Your printers"
        description={
          profiles.length
            ? `${profiles.length} printer${profiles.length === 1 ? '' : 's'} configured. Disabled printers keep existing assignments but receive no new ones.`
            : 'No printers configured. Add a machine to assign queued work.'
        }
      >
        <div className="grid gap-3">
          {profiles.map((profile, index) => (
            <PrinterEditor
              key={profile.id}
              profile={profile}
              index={index}
              onChange={(next) => setProfiles((current) => current.map((item) => (item.id === next.id ? next : item)))}
              onRemove={() => setRemoveId(profile.id)}
            />
          ))}
          <PrinterPresetPicker disabled={mutation.isPending} onSelect={addPresetPrinter} onCustom={addCustomPrinter} />
        </div>
        <FieldError>{error}</FieldError>
      </SettingsSection>

      <SettingsActions>
        <Button
          type="button"
          disabled={!dirty || !!error || mutation.isPending}
          onClick={() => mutation.mutate(profiles.map(normalizePrinterProfile))}
        >
          {mutation.isPending ? 'Saving…' : onboarding ? 'Save and continue' : 'Save printers'}
        </Button>
        {!onboarding && (
          <Button type="button" variant="outline" disabled={!dirty || mutation.isPending} onClick={() => setProfiles(savedProfiles)}>
            Discard changes
          </Button>
        )}
      </SettingsActions>
      <UnsavedChangesGuard dirty={dirty} />
      <ConfirmDialog
        open={!!removeProfile}
        title={removeProfile ? `Remove “${removeProfile.name || 'this printer'}”?` : 'Remove printer?'}
        description="Existing requests assigned to this printer will become unassigned when you save."
        confirmLabel="Remove printer"
        destructive
        onCancel={() => setRemoveId(null)}
        onConfirm={() => removeProfile && setProfiles((current) => current.filter((profile) => profile.id !== removeProfile.id))}
      />
    </>
  )

  return onboarding ? content : <SettingsPage>{content}</SettingsPage>
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
  return (
    <div className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${profile.id}-name`}>Printer name</FieldLabel>
            <Input
              id={`${profile.id}-name`}
              value={profile.name}
              placeholder={profile.printType === 'resin' ? 'Resin printer' : 'Filament printer'}
              onChange={(event) => onChange({ ...profile, name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${profile.id}-print-type`}>Print type</FieldLabel>
            <Select
              items={PRINT_TYPES}
              value={profile.printType}
              onValueChange={(printType) => printType && onChange({ ...profile, printType })}
            >
              <SelectTrigger id={`${profile.id}-print-type`} aria-label={`Print type for ${profile.name || `printer ${index + 1}`}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRINT_TYPES.map((printType) => (
                  <SelectItem key={printType.value} value={printType.value}>
                    {printType.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${profile.name || `printer ${index + 1}`}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{profile.printType === 'resin' ? 'Resin' : 'Filament'}</Badge>
          <FieldDescription>Use this printer for manual queue assignment and workload tracking.</FieldDescription>
        </div>
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel htmlFor={`${profile.id}-enabled`}>Enabled</FieldLabel>
          <Switch
            id={`${profile.id}-enabled`}
            checked={profile.enabled}
            onCheckedChange={(enabled) => onChange({ ...profile, enabled })}
            aria-label={`Enable ${profile.name || `printer ${index + 1}`}`}
          />
        </Field>
      </div>
    </div>
  )
}

function defaultPrintType(profiles: PrinterProfile[]): PrintType {
  if (!profiles.length) return 'resin'
  return profiles.every((profile) => profile.printType === 'resin') ? 'filament' : 'resin'
}

function defaultPrinterProfile(printType: PrintType): PrinterProfile {
  return { id: crypto.randomUUID(), name: '', printType, enabled: true }
}

function profileFromPreset(preset: PrinterPreset): PrinterProfile {
  return { id: crypto.randomUUID(), name: `${preset.brand} ${preset.model}`, printType: preset.printType, enabled: true }
}

function profilesValidationError(profiles: PrinterProfile[]) {
  const names = new Set<string>()
  for (const profile of profiles) {
    const name = profile.name.trim()
    if (!name) return 'Give every printer a name.'
    if (names.has(name.toLowerCase())) return 'Printer names must be unique.'
    names.add(name.toLowerCase())
  }
  return ''
}
