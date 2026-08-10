import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Archive, ArrowLeft, Printer, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  newPrinterProfile,
  nextPrinterPrintType,
  normalizePrinterProfile,
  printerProfileFromPreset,
  printerProfilesValidationError,
} from '../../../core/printers'
import { getPrinterPreset, PRINTER_PRESETS, type PrinterPreset } from '../../../core/printerPresets'
import type { PrinterProfile, PrintType } from '../../../core/types'
import { savePrinterProfiles } from '../../../server/fns'
import { createId } from '../../id'
import { errorMessage } from '../../../core/error'
import { printersQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { signalProductTourProgress } from '../../productTour'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { SettingNotice, type Notice } from '../SettingNotice'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const PRINT_TYPES: { value: PrintType; label: string }[] = [
  { value: 'resin', label: 'Resin' },
  { value: 'filament', label: 'Filament' },
]

export function PrintersPane({
  onboarding = false,
  onSaved,
  onBack,
}: { onboarding?: boolean; onSaved?: () => void; onBack?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(printersQuery(workspaceSlug))
  const data = query.data
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const [savedProfiles, setSavedProfiles] = useState<PrinterProfile[]>([])
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [saved, setSaved] = useState<Notice>()
  const dirty = JSON.stringify(profiles) !== JSON.stringify(savedProfiles)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const callSave = useServerFn(savePrinterProfiles)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (next: PrinterProfile[]) => callSave({ data: { workspaceSlug, profiles: next } }),
    onMutate: () => setSaved(undefined),
    onSuccess: async (result) => {
      const next = result.profiles.map(normalizePrinterProfile)
      const newlyArchived = next.some(
        (profile) => profile.archived && !savedProfiles.find((savedProfile) => savedProfile.id === profile.id)?.archived,
      )
      setProfiles(next)
      setSavedProfiles(next)
      const active = next.filter(({ archived }) => !archived)
      if (active.length) signalProductTourProgress('printers')
      if (onboarding) onSaved?.()
      else
        setSaved(
          newlyArchived
            ? {
                tone: 'success',
                title: 'Printer archived',
                hint: 'It remains visible in print history and is unavailable for new assignments.',
              }
            : active.length
              ? { tone: 'success', title: 'Printers saved', hint: 'They are available when assigning prints on the board.' }
              : next.length
                ? {
                    tone: 'success',
                    title: 'Printer archived',
                    hint: 'It remains visible in print history and is unavailable for new assignments.',
                  }
                : {
                    tone: 'success',
                    title: 'Printer list cleared',
                    hint: 'Requests stay on the board and remain unassigned until you add a printer.',
                  },
        )
      await invalidateQueries(queryClient, 'printers', 'session', 'requests')
    },
  })

  useEffect(() => {
    if (!data || dirtyRef.current) return
    const next = data.profiles.map(normalizePrinterProfile)
    setProfiles(next)
    setSavedProfiles(next)
  }, [data])

  const error = useMemo(() => printerProfilesValidationError(profiles), [profiles])
  const removeProfile = profiles.find((profile) => profile.id === removeId)
  const activeProfiles = profiles.filter(({ archived }) => !archived)
  const archivedProfiles = profiles.filter(({ archived }) => archived)
  const addedPresetIds = new Set(activeProfiles.map((profile) => profile.presetId).filter((id): id is string => !!id))
  const addCustomPrinter = () => setProfiles((current) => [...current, newPrinterProfile(createId(), nextPrinterPrintType(current))])
  const addPresetPrinter = (preset: PrinterPreset) => setProfiles((current) => [...current, printerProfileFromPreset(createId(), preset)])

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

  const printerTable = activeProfiles.length > 0 && (
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
          {activeProfiles.map((profile, index) => (
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
  )
  const failure = mutation.error ? errorMessage(mutation.error, 'Please try again.') : undefined

  const content = onboarding ? (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
            <ArrowLeft /> Back to storage
          </Button>
        )}
        <h3 className="font-heading text-xl font-semibold">Add the printers you own</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Operators assign queued prints to these machines. Slicing and build preparation stay in your slicer, so a name and a print type
          are all STL Quest needs.
        </p>
      </div>
      {profiles.length > 0 ? (
        <div className="flex flex-col gap-3">
          {printerTable}
          <PrinterPresetPicker
            added={addedPresetIds}
            disabled={mutation.isPending}
            onSelect={addPresetPrinter}
            onCustom={addCustomPrinter}
          />
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 max-sm:flex-col max-sm:items-stretch sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Printer className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Start from a known model</span>
              <Badge>{PRINTER_PRESETS.length} presets</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Search by brand or model and the print type is filled in for you. Anything unusual can be added by hand.
            </p>
            <div className="mt-3">
              <PrinterPresetPicker
                variant="default"
                added={addedPresetIds}
                disabled={mutation.isPending}
                onSelect={addPresetPrinter}
                onCustom={addCustomPrinter}
              />
            </div>
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
      <SettingNotice
        notice={
          failure
            ? { tone: 'error', title: 'Printers were not saved', hint: 'Your edits are still here. Try saving again.', detail: failure }
            : dirty
              ? undefined
              : saved
        }
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!profiles.length || !!error || mutation.isPending}
            onClick={() => mutation.mutate(profiles.map(normalizePrinterProfile))}
          >
            {mutation.isPending ? 'Saving…' : 'Save and continue'}
          </Button>
          {!profiles.length && (
            <Button type="button" variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate([])}>
              Skip for now
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The board works without printers. Add them any time from Settings, and queued prints stay unassigned until you do.
        </p>
      </div>
    </div>
  ) : (
    <>
      <SettingsHeader title="Printers" description="Manage the machines available for print assignment." />

      <SettingsSection
        title="Your printers"
        description={
          activeProfiles.length
            ? `${activeProfiles.length} printer${activeProfiles.length === 1 ? '' : 's'} configured.`
            : 'No printers configured. Add a machine to assign queued work.'
        }
      >
        <div className="flex flex-col gap-3" data-onboarding="printers">
          {printerTable}
          <PrinterPresetPicker
            added={addedPresetIds}
            disabled={mutation.isPending}
            onSelect={addPresetPrinter}
            onCustom={addCustomPrinter}
          />
        </div>
        <FieldError>{error}</FieldError>
      </SettingsSection>

      {archivedProfiles.length > 0 && (
        <SettingsSection title="Archived printers" description="Kept for the history of prints completed on them.">
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableBody>
                {archivedProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="font-medium">{profile.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {PRINT_TYPES.find(({ value }) => value === profile.printType)?.label}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() =>
                          setProfiles((current) =>
                            current.map((candidate) => (candidate.id === profile.id ? { ...candidate, archived: undefined } : candidate)),
                          )
                        }
                      >
                        <RotateCcw /> Restore printer
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SettingsSection>
      )}

      <SettingsActions>
        <Button
          type="button"
          disabled={!dirty || !!error || mutation.isPending}
          onClick={() => mutation.mutate(profiles.map(normalizePrinterProfile))}
        >
          {mutation.isPending ? 'Saving…' : 'Save printers'}
        </Button>
        <Button type="button" variant="outline" disabled={!dirty || mutation.isPending} onClick={() => setProfiles(savedProfiles)}>
          Discard changes
        </Button>
      </SettingsActions>
      <UnsavedChangesGuard dirty={dirty} />
    </>
  )

  const removalDialog = (
    <ConfirmDialog
      open={!!removeProfile}
      title={removeProfile ? `${removeProfile.used ? 'Archive' : 'Remove'} “${removeProfile.name || 'this printer'}”?` : 'Remove printer?'}
      description={
        removeProfile?.used
          ? 'This printer has print history. It will no longer be available for new assignments, but completed prints will continue to show it.'
          : 'This printer has not been used and will be removed permanently when you save.'
      }
      confirmLabel={removeProfile?.used ? 'Archive printer' : 'Remove printer'}
      destructive
      onCancel={() => setRemoveId(null)}
      onConfirm={() => {
        if (!removeProfile) return
        setProfiles((current) =>
          removeProfile.used
            ? current.map((profile) => (profile.id === removeProfile.id ? { ...profile, archived: true } : profile))
            : current.filter((profile) => profile.id !== removeProfile.id),
        )
        setRemoveId(null)
      }}
    />
  )

  if (onboarding)
    return (
      <>
        {content}
        {removalDialog}
      </>
    )
  return (
    <SettingsPage>
      {content}
      {removalDialog}
    </SettingsPage>
  )
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
          aria-label={`${profile.used ? 'Archive' : 'Remove'} ${profile.name || `printer ${index + 1}`}`}
          onClick={onRemove}
        >
          {profile.used ? <Archive /> : <Trash2 />}
        </Button>
      </TableCell>
    </TableRow>
  )
}
