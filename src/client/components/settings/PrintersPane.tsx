import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { normalizePrinterProfile } from '../../../core/printers'
import { getPrinterPreset, type PrinterPreset } from '../../../core/printerPresets'
import type { PrinterProfile, PrintType } from '../../../core/types'
import { savePrinterProfiles } from '../../../server/fns'
import { createId } from '../../id'
import { printersQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const PRINT_TYPES: { value: PrintType; label: string }[] = [
  { value: 'resin', label: 'Resin' },
  { value: 'filament', label: 'Filament' },
]

export function PrintersPane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(printersQuery(workspaceSlug))
  const data = query.data
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

  if (!data) {
    return (
      <QueryState
        loading={query.isPending}
        error={query.error}
        loadingLabel="Loading printer settings…"
        errorTitle="Could not load printer settings"
        onRetry={() => void query.refetch()}
      />
    )
  }

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
            ? `${profiles.length} printer${profiles.length === 1 ? '' : 's'} configured.`
            : 'No printers configured. Add a machine to assign queued work.'
        }
      >
        <div className="flex flex-col gap-3">
          {profiles.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-14">
                      <span className="sr-only">Image</span>
                    </TableHead>
                    <TableHead>Printer</TableHead>
                    <TableHead>Print type</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Remove</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((profile, index) => (
                    <PrinterRow
                      key={profile.id}
                      profile={profile}
                      index={index}
                      onChange={(next) => setProfiles((current) => current.map((item) => (item.id === next.id ? next : item)))}
                      onRemove={() => setRemoveId(profile.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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

  return <SettingsPage>{content}</SettingsPage>
}

function PrinterRow({
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
  const preset = getPrinterPreset(profile.presetId)

  return (
    <TableRow aria-label={`Printer ${index + 1}`}>
      <TableCell>
        <PrinterPresetImage printer={preset ?? profile} className="size-10 shrink-0 rounded-md border bg-muted/40" />
      </TableCell>
      <TableCell className="w-full min-w-40 whitespace-normal">
        <Field>
          <FieldLabel htmlFor={`${profile.id}-name`} className="sr-only">
            Printer name
          </FieldLabel>
          <Input
            id={`${profile.id}-name`}
            value={profile.name}
            placeholder={profile.printType === 'resin' ? 'Resin printer' : 'Filament printer'}
            maxLength={100}
            onChange={(event) => onChange({ ...profile, name: event.target.value })}
          />
        </Field>
      </TableCell>
      <TableCell className="min-w-36">
        <Field>
          <FieldLabel htmlFor={`${profile.id}-print-type`} className="sr-only">
            Print type
          </FieldLabel>
          <Select
            items={PRINT_TYPES}
            value={profile.printType}
            onValueChange={(printType) =>
              printType && onChange({ ...profile, printType, presetId: printType === profile.printType ? profile.presetId : undefined })
            }
          >
            <SelectTrigger
              id={`${profile.id}-print-type`}
              className="w-full"
              aria-label={`Print type for ${profile.name || `printer ${index + 1}`}`}
            >
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
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${profile.name || `printer ${index + 1}`}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </TableCell>
    </TableRow>
  )
}

function defaultPrintType(profiles: PrinterProfile[]): PrintType {
  if (!profiles.length) return 'resin'
  return profiles.every((profile) => profile.printType === 'resin') ? 'filament' : 'resin'
}

function defaultPrinterProfile(printType: PrintType): PrinterProfile {
  return { id: createId(), name: '', printType }
}

function profileFromPreset(preset: PrinterPreset): PrinterProfile {
  return {
    id: createId(),
    presetId: preset.id,
    widthMm: preset.widthMm,
    depthMm: preset.depthMm,
    heightMm: preset.heightMm,
    name: `${preset.brand} ${preset.model}`,
    printType: preset.printType,
  }
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
