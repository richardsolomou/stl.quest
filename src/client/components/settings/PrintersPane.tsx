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
import { SettingNotice } from '../SettingNotice'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

const printTypeOptions = (labels: Record<PrintType, string>) =>
  (['resin', 'filament'] as const).map((value) => ({ value, label: labels[value] }))

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
  const failedProfiles = useRef<string | undefined>(undefined)
  const dirty = JSON.stringify(profiles) !== JSON.stringify(savedProfiles)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const callSave = useServerFn(savePrinterProfiles)
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.printers
  const mutation = useMutation({
    mutationFn: (next: PrinterProfile[]) => callSave({ data: { workspaceSlug, profiles: next } }),
    onMutate: () => {
      failedProfiles.current = undefined
    },
    onError: (_error, next) => {
      failedProfiles.current = JSON.stringify(next)
    },
    onSuccess: async (result) => {
      const next = result.profiles.map(normalizePrinterProfile)
      setProfiles(next)
      setSavedProfiles(next)
      const active = next.filter(({ archived }) => !archived)
      if (active.length) signalProductTourProgress('printers')
      if (onboarding) onSaved?.()
      await invalidateQueries(queryClient, 'printers', 'session', 'requests')
    },
  })
  const mutate = mutation.mutate

  useEffect(() => {
    if (!data || dirtyRef.current) return
    const next = data.profiles.map(normalizePrinterProfile)
    setProfiles(next)
    setSavedProfiles(next)
  }, [data])

  const error = useMemo(() => printerProfilesValidationError(profiles, t), [profiles, t])
  useEffect(() => {
    if (onboarding || !dirty || error || mutation.isPending) return
    const next = profiles.map(normalizePrinterProfile)
    if (failedProfiles.current === JSON.stringify(next)) return
    const timeout = window.setTimeout(() => mutate(next), 600)
    return () => window.clearTimeout(timeout)
  }, [dirty, error, mutate, mutation.isPending, onboarding, profiles])

  const persist = (next: PrinterProfile[]) => {
    const normalized = next.map(normalizePrinterProfile)
    setProfiles(normalized)
    mutation.mutate(normalized)
  }

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
        loadingLabel={copy.loading}
        errorTitle={copy.loadError}
        onRetry={() => void query.refetch()}
      />
    )
  }

  // Narrow containers stack each row into a card so every field keeps its full width and a visible label.
  const printerTable = activeProfiles.length > 0 && (
    <div className="@container overflow-hidden rounded-lg border">
      <Table className="@max-lg:block">
        <TableHeader className="@max-lg:hidden">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-14">
              <span className="sr-only">{copy.table.image}</span>
            </TableHead>
            <TableHead>{copy.table.printer}</TableHead>
            <TableHead>{copy.table.printType}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t.common.remove}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="@max-lg:block">
          {activeProfiles.map((profile, index) => (
            <PrinterRow
              key={profile.id}
              profile={profile}
              index={index}
              disabled={mutation.isPending}
              onChange={(next) => setProfiles((current) => current.map((item) => (item.id === next.id ? next : item)))}
              onRemove={() => setRemoveId(profile.id)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
  const failure = mutation.error ? errorMessage(mutation.error, copy.tryAgainFallback) : undefined

  const content = onboarding ? (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
            <ArrowLeft /> {copy.onboarding.back}
          </Button>
        )}
        <h3 className="font-heading text-xl font-semibold">{copy.onboarding.title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.onboarding.description}</p>
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
              <span className="font-medium">{copy.onboarding.presetsTitle}</span>
              <Badge>{copy.onboarding.presetCount(PRINTER_PRESETS.length)}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.onboarding.presetsDescription}</p>
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
        notice={failure ? { tone: 'error', title: copy.notSaved, hint: copy.onboarding.notSavedHint, detail: failure } : undefined}
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!profiles.length || !!error || mutation.isPending}
            onClick={() => mutation.mutate(profiles.map(normalizePrinterProfile))}
          >
            {mutation.isPending ? t.common.saving : copy.onboarding.save}
          </Button>
          {!profiles.length && (
            <Button type="button" variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate([])}>
              {copy.onboarding.skip}
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.onboarding.skipHint}</p>
      </div>
    </div>
  ) : (
    <>
      <SettingsHeader title={copy.title} description={copy.description} />

      <SettingsSection
        title={copy.active.title}
        description={activeProfiles.length ? copy.active.count(activeProfiles.length) : copy.active.empty}
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
        <SettingsSection title={copy.archived.title} description={copy.archived.description}>
          <div className="@container overflow-hidden rounded-lg border">
            <Table>
              <TableBody>
                {archivedProfiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell className="w-full max-w-0">
                      <span className="block truncate font-medium" title={profile.name}>
                        {profile.name}
                      </span>
                      <span className="block text-xs text-muted-foreground @sm:hidden">{copy.printTypes[profile.printType]}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground @max-sm:hidden">{copy.printTypes[profile.printType]}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() =>
                          persist(
                            profiles.map((candidate) => (candidate.id === profile.id ? { ...candidate, archived: undefined } : candidate)),
                          )
                        }
                      >
                        <RotateCcw />
                        <span className="@max-sm:sr-only">{copy.archived.restore}</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SettingsSection>
      )}

      <SettingNotice notice={failure ? { tone: 'error', title: copy.notSaved, hint: copy.notSavedHint, detail: failure } : undefined} />
      {failure ? (
        <SettingsActions>
          <Button
            type="button"
            disabled={!!error || mutation.isPending}
            onClick={() => mutation.mutate(profiles.map(normalizePrinterProfile))}
          >
            {t.common.retry}
          </Button>
        </SettingsActions>
      ) : null}
    </>
  )

  const removalDialog = (
    <ConfirmDialog
      open={!!removeProfile}
      title={
        removeProfile
          ? (removeProfile.used ? copy.remove.archiveTitle : copy.remove.removeTitle)(removeProfile.name || copy.remove.thisPrinter)
          : copy.remove.fallbackTitle
      }
      description={removeProfile?.used ? copy.remove.archiveDescription : copy.remove.removeDescription}
      confirmLabel={removeProfile?.used ? copy.remove.archiveAction : copy.remove.removeAction}
      destructive
      onCancel={() => setRemoveId(null)}
      onConfirm={() => {
        if (!removeProfile) return
        persist(
          removeProfile.used
            ? profiles.map((profile) => (profile.id === removeProfile.id ? { ...profile, archived: true } : profile))
            : profiles.filter((profile) => profile.id !== removeProfile.id),
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
    <SettingsPage data-saving={dirty || mutation.isPending}>
      {content}
      {removalDialog}
    </SettingsPage>
  )
}

function PrinterRow({
  profile,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  profile: PrinterProfile
  index: number
  disabled: boolean
  onChange: (profile: PrinterProfile) => void
  onRemove: () => void
}) {
  const preset = getPrinterPreset(profile.presetId)
  const { t } = useI18n()
  const copy = t.settings.printers
  const printTypes = printTypeOptions(copy.printTypes)
  const displayName = profile.name || copy.row.fallbackName(index + 1)

  return (
    <TableRow
      aria-label={copy.row.label(index + 1)}
      className="@max-lg:grid @max-lg:grid-cols-[minmax(0,1fr)_auto] @max-lg:gap-x-3 @max-lg:gap-y-3 @max-lg:p-3"
    >
      <TableCell className="@max-lg:p-0">
        <PrinterPresetImage printer={preset ?? profile} className="size-10 shrink-0 rounded-md border bg-muted/40" />
      </TableCell>
      <TableCell className="w-full min-w-40 whitespace-normal @max-lg:col-span-2 @max-lg:row-start-2 @max-lg:min-w-0 @max-lg:p-0">
        <Field>
          <FieldLabel htmlFor={`${profile.id}-name`} className="@lg:sr-only">
            {copy.row.name}
          </FieldLabel>
          <Input
            id={`${profile.id}-name`}
            value={profile.name}
            placeholder={copy.row.placeholder[profile.printType]}
            maxLength={100}
            disabled={disabled}
            onChange={(event) => onChange({ ...profile, name: event.target.value })}
          />
        </Field>
      </TableCell>
      <TableCell className="min-w-36 @max-lg:col-span-2 @max-lg:row-start-3 @max-lg:min-w-0 @max-lg:p-0">
        <Field>
          <FieldLabel htmlFor={`${profile.id}-print-type`} className="@lg:sr-only">
            {copy.table.printType}
          </FieldLabel>
          <Select
            items={printTypes}
            value={profile.printType}
            disabled={disabled}
            onValueChange={(printType) =>
              printType && onChange({ ...profile, printType, presetId: printType === profile.printType ? profile.presetId : undefined })
            }
          >
            <SelectTrigger id={`${profile.id}-print-type`} className="w-full" aria-label={copy.row.printTypeLabel(displayName)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {printTypes.map((printType) => (
                <SelectItem key={printType.value} value={printType.value}>
                  {printType.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </TableCell>
      <TableCell className="@max-lg:col-start-2 @max-lg:row-start-1 @max-lg:p-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={(profile.used ? copy.row.archiveLabel : copy.row.removeLabel)(displayName)}
          disabled={disabled}
          onClick={onRemove}
        >
          {profile.used ? <Archive /> : <Trash2 />}
        </Button>
      </TableCell>
    </TableRow>
  )
}
