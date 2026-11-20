import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ArrowLeft, ChevronRight, Printer, RotateCcw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import {
  newPrinterProfile,
  nextPrinterPrintType,
  normalizePrinterProfile,
  printerModelName,
  printerProfileFromPreset,
  printerProfilesValidationError,
  uniquePrinterName,
} from '../../../core/printers'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS } from '../../../core/priceCalculator'
import { getPrinterPreset, PRINTER_PRESETS, type PrinterPreset } from '../../../core/printerPresets'
import { PRINT_TYPES, type PrinterProfile } from '../../../core/types'
import { skipPrinterSetup } from '../../../server/fns'
import { createId } from '../../id'
import { errorMessage } from '../../../core/error'
import { priceCalculatorSettingsQuery, printersQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { useInventory } from '../../inventory'
import { useWorkspacePrintTypes, useWorkspaceSlug } from '../../workspace'
import { signalProductTourProgress } from '../../productTour'
import { ConfirmDialog } from '../ConfirmDialog'
import { AlsoPrints } from './AlsoPrints'
import { QueryState } from '../QueryState'
import { SettingNotice } from '../SettingNotice'
import { PrinterDialog } from './PrinterDialog'
import { PrinterPresetImage } from './PrinterPresetImage'
import { PrinterPresetPicker } from './PrinterPresetPicker'
import { VirtualList } from './VirtualList'
import { SettingsActions, PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'
import { matchesListSearch, showsListSearch } from '../../listSearch'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

export function PrintersPane({
  onboarding = false,
  onSaved,
  onBack,
}: { onboarding?: boolean; onSaved?: () => void; onBack?: () => void } = {}) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(printersQuery(workspaceSlug))
  const data = query.data
  // Onboarding keeps the printers it adds here until "Save and continue"; settings store each change straight away.
  const [drafts, setDrafts] = useState<PrinterProfile[]>([])
  const profiles = useMemo(() => (onboarding ? drafts : (data?.profiles ?? [])), [onboarding, drafts, data])
  const [removeId, setRemoveId] = useState<string | null>(null)
  // A custom printer being added is kept here, not in the list, until its dialog has it named and saves it.
  const [editing, setEditing] = useState<PrinterProfile | null>(null)
  const currency =
    useQuery({ ...priceCalculatorSettingsQuery(workspaceSlug), enabled: !onboarding }).data?.settings.currency ??
    DEFAULT_PRICE_CALCULATOR_SETTINGS.currency
  const [search, setSearch] = useState('')
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.printers
  const printTypes = useWorkspacePrintTypes()
  const { mutation, save, setArchived } = useInventory('printers')
  const callSkip = useServerFn(skipPrinterSetup)
  // Finishing onboarding creates each printer it collected, or records that setup was skipped when there are none.
  const finishSetup = useMutation({
    mutationFn: async () => {
      for (const profile of drafts) await save(normalizePrinterProfile(profile))
      if (!drafts.length) await callSkip({ data: { workspaceSlug } })
    },
    onSuccess: () => onSaved?.(),
  })
  const pending = mutation.isPending || finishSetup.isPending

  const error = useMemo(() => printerProfilesValidationError(profiles, t), [profiles, t])

  // The session and board show printers too, so they refresh at once rather than when the workspace channel says so.
  const refreshFleet = () => invalidateQueries(queryClient, 'session', 'requests')
  const saveProfile = async (profile: PrinterProfile) => {
    const normalized = normalizePrinterProfile(profile)
    if (!onboarding) {
      await save(normalized)
      signalProductTourProgress('printers')
      return await refreshFleet()
    }
    setDrafts((current) =>
      current.some(({ id }) => id === normalized.id)
        ? current.map((candidate) => (candidate.id === normalized.id ? normalized : candidate))
        : [...current, normalized],
    )
  }
  const archive = (id: string, archived: boolean) => void setArchived(id, archived).then(refreshFleet, () => undefined)
  const closeEditor = () => {
    setEditing(null)
    // The dialog showed its own failure; the pane's notice is for changes made from the list.
    if (mutation.isError) mutation.reset()
  }

  const removeProfile = profiles.find((profile) => profile.id === removeId)
  const activeProfiles = profiles.filter(({ archived }) => !archived)
  const archivedProfiles = profiles.filter(({ archived }) => archived)
  const addedPresetIds = new Set(activeProfiles.map((profile) => profile.presetId).filter((id): id is string => !!id))
  const addCustomPrinter = (printType = printTypes.length === 1 ? printTypes[0] : nextPrinterPrintType(activeProfiles)) =>
    setEditing(newPrinterProfile(createId(), printType))
  const addPresetPrinter = (preset: PrinterPreset) => {
    const added = printerProfileFromPreset(createId(), preset)
    void saveProfile({ ...added, name: uniquePrinterName(added.name, profiles) }).catch(() => undefined)
  }

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

  const searchable = showsListSearch(activeProfiles.length)
  const found = activeProfiles.filter((profile) => {
    const preset = getPrinterPreset(profile.presetId)
    return matchesListSearch(search, [profile.name, preset?.brand, preset?.model, copy.printTypes[profile.printType]])
  })
  // A mixed fleet reads as its resin and filament machines; a single-type fleet needs no grouping heading.
  const groups = PRINT_TYPES.map((printType) => ({
    printType,
    profiles: found.filter((profile) => profile.printType === printType),
  })).filter(({ profiles: grouped }) => grouped.length > 0)
  const grouped = new Set(activeProfiles.map((profile) => profile.printType)).size > 1
  // Each type the workspace prints or owns a printer of gets a section; any other folds to one invitation line.
  const sectionTypes = activeProfiles.length
    ? PRINT_TYPES.filter((printType) => printTypes.includes(printType) || activeProfiles.some((profile) => profile.printType === printType))
    : []
  const searchField = (
    <InputGroup className="max-w-sm bg-field">
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={copy.search}
        placeholder={copy.search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    </InputGroup>
  )
  // Onboarding keeps its short list in one place, headed by print type only when the fleet mixes them.
  const printerList = activeProfiles.length > 0 && (
    <div className="flex flex-col gap-3">
      {searchable && searchField}
      {found.length === 0 && <p className="text-sm text-muted-foreground">{copy.noMatches(search.trim())}</p>}
      {groups.map(({ printType, profiles: groupProfiles }) => (
        <section key={printType} className="flex flex-col gap-1.5" aria-label={grouped ? copy.printTypes[printType] : undefined}>
          {grouped && (
            <h3 className="px-1 font-heading text-sm font-extrabold tracking-[0.015em] uppercase">
              {copy.printTypes[printType]} · {groupProfiles.length}
            </h3>
          )}
          <PrinterList profiles={groupProfiles} all={activeProfiles} onOpen={setEditing} />
        </section>
      ))}
    </div>
  )
  const failed = mutation.error ?? finishSetup.error
  const failure = failed ? errorMessage(failed, copy.tryAgainFallback) : undefined

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
          <div>
            <PrinterPresetPicker added={addedPresetIds} disabled={pending} onSelect={addPresetPrinter} onCustom={addCustomPrinter} />
          </div>
          {printerList}
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 max-sm:flex-col max-sm:items-stretch sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Printer className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{copy.onboarding.presetsTitle}</span>
              <Badge variant="secondary">{copy.onboarding.presetCount(PRINTER_PRESETS.length)}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.onboarding.presetsDescription}</p>
            <div className="mt-3">
              <PrinterPresetPicker
                variant="default"
                added={addedPresetIds}
                disabled={pending}
                onSelect={addPresetPrinter}
                onCustom={() => addCustomPrinter()}
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
          <Button type="button" disabled={!profiles.length || !!error || pending} onClick={() => finishSetup.mutate()}>
            {pending ? t.common.saving : copy.onboarding.save}
          </Button>
          {!profiles.length && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => finishSetup.mutate()}>
              {copy.onboarding.skip}
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{copy.onboarding.skipHint}</p>
      </div>
    </div>
  ) : (
    <>
      {/* In the header so a farm's long list never pushes adding a printer out of reach. */}
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <PrinterPresetPicker
            variant="default"
            added={addedPresetIds}
            disabled={pending}
            onSelect={addPresetPrinter}
            onCustom={() => addCustomPrinter()}
          />
        }
      />

      {searchable && searchField}
      {search.trim() !== '' && found.length === 0 && <p className="text-sm text-muted-foreground">{copy.noMatches(search.trim())}</p>}
      {/* One section per print type, as Consumables lists each kind; a single-type fleet shows just its own. */}
      {sectionTypes.length ? (
        sectionTypes.map((printType, index) => {
          const shown = found.filter((profile) => profile.printType === printType)
          const count = activeProfiles.filter((profile) => profile.printType === printType).length
          return (
            <SettingsSection
              key={printType}
              layout="stacked"
              data-onboarding={index === 0 ? 'printers' : undefined}
              title={count ? `${copy.sections[printType]} · ${count}` : copy.sections[printType]}
              action={
                <PrinterPresetPicker
                  size="sm"
                  label={copy.addOfType[printType]}
                  printType={printType}
                  added={addedPresetIds}
                  disabled={pending}
                  onSelect={addPresetPrinter}
                  onCustom={() => addCustomPrinter(printType)}
                />
              }
            >
              {shown.length > 0 && <PrinterList profiles={shown} all={activeProfiles} onOpen={setEditing} />}
            </SettingsSection>
          )
        })
      ) : (
        <SettingsSection layout="stacked" data-onboarding="printers" title={copy.active.title} description={copy.active.empty} />
      )}
      {sectionTypes.length > 0 &&
        PRINT_TYPES.filter((printType) => !sectionTypes.includes(printType)).map((printType) => (
          <AlsoPrints key={printType} printType={printType}>
            <PrinterPresetPicker
              variant="link"
              label={copy.addOfType[printType]}
              printType={printType}
              added={addedPresetIds}
              disabled={pending}
              onSelect={addPresetPrinter}
              onCustom={() => addCustomPrinter(printType)}
            />
          </AlsoPrints>
        ))}
      <FieldError>{error}</FieldError>

      {archivedProfiles.length > 0 && (
        <SettingsSection layout="stacked" title={copy.archived.title} description={copy.archived.description}>
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
                      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => archive(profile.id, false)}>
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
      {failure && mutation.variables ? (
        <SettingsActions>
          <Button type="button" disabled={pending} onClick={() => mutation.mutate(mutation.variables)}>
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
          ? (onboarding ? copy.remove.removeTitle : copy.remove.archiveTitle)(removeProfile.name || copy.remove.thisPrinter)
          : copy.remove.fallbackTitle
      }
      description={onboarding ? copy.remove.removeDescription : copy.remove.archiveDescription}
      confirmLabel={onboarding ? copy.remove.removeAction : copy.remove.archiveAction}
      destructive
      onCancel={() => setRemoveId(null)}
      onConfirm={() => {
        if (!removeProfile) return
        if (onboarding) setDrafts((current) => current.filter((profile) => profile.id !== removeProfile.id))
        else archive(removeProfile.id, true)
        setRemoveId(null)
        closeEditor()
      }}
    />
  )
  const editor = editing && (
    <PrinterDialog
      key={editing.id}
      printer={editing}
      isNew={!profiles.some(({ id }) => id === editing.id)}
      profiles={profiles}
      currency={currency}
      stored={!onboarding}
      onSave={saveProfile}
      onRemove={() => setRemoveId(editing.id)}
      onClose={closeEditor}
    />
  )

  if (onboarding)
    return (
      <>
        {content}
        {editor}
        {removalDialog}
      </>
    )
  return (
    <SettingsPage data-saving={pending}>
      {content}
      {editor}
      {removalDialog}
    </SettingsPage>
  )
}

function PrinterList({
  profiles,
  all,
  onOpen,
}: {
  profiles: PrinterProfile[]
  /** Every active printer, which numbers an unnamed one. */
  all: PrinterProfile[]
  onOpen: (profile: PrinterProfile) => void
}) {
  return (
    <VirtualList
      items={profiles}
      getKey={({ id }) => id}
      renderItem={(profile) => <PrinterRow profile={profile} index={all.indexOf(profile)} onOpen={() => onOpen(profile)} />}
    />
  )
}

function PrinterRow({ profile, index, onOpen }: { profile: PrinterProfile; index: number; onOpen: () => void }) {
  const preset = getPrinterPreset(profile.presetId)
  const { t } = useI18n()
  const copy = t.settings.printers
  const displayName = profile.name || copy.row.fallbackName(index + 1)
  // Bay names such as "X1C · A" hide the machine, so the catalogue model shows beneath unless the name already says it.
  const catalogueName = preset && printerModelName(preset)
  const model = catalogueName && catalogueName.toLocaleLowerCase() !== profile.name.trim().toLocaleLowerCase() ? catalogueName : undefined

  return (
    <button
      type="button"
      aria-label={copy.row.open(displayName)}
      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      onClick={onOpen}
    >
      <PrinterPresetImage printer={preset ?? profile} className="size-10 rounded-md border bg-muted/40" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium @max-sm:line-clamp-2 @sm:truncate">{displayName}</span>
        {model && <span className="block truncate text-xs text-muted-foreground">{model}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}
