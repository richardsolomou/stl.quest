import { useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { FileUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { errorMessage } from '../../../core/error'
import {
  MAX_PLATE_FILAMENTS,
  matchSlicedObjects,
  plateTotalsProblem,
  splitPlate,
  type PlateMaterialChoice,
  type PlateMeasured,
  type PlateTotals,
} from '../../../core/plates'
import { readSlicedFile, type SlicedPlate } from '../../../core/slicedPlate'
import type { PrintType } from '../../../core/types'
import type { UsageUnit } from '../../../core/usage'
import { deletePlate, recordPlate, undoUsage } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { measuredRecord, slicedObjectLabel, suggestedFilament } from '../../plateRecord'
import { catalogueQuery, consumablesQuery, platesQuery, printersQuery, type PlateView } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { ColourSwatch } from '../ColourSwatch'
import { ConfirmDialog } from '../ConfirmDialog'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { formatUsageAmount } from '../spend/format'
import { PlateMaterialField, plateMaterialChoice, type MaterialDraft } from './PlateMaterialField'
import { PlateSlicerButton } from './PlateSlicerButton'

export type PlateMode = 'view' | 'file' | 'totals'

const NOT_IN_STL_QUEST = 'none'

/**
 * One plate: what went on it and, once recorded, what each print used. Recording reads the slicer's exported file in
 * the browser, matches its objects to the plate's prints by model name for the operator to confirm, or takes typed
 * totals that the server splits by model volume.
 */
export function PlateDialog({ plateId, mode: initialMode = 'view', onClose }: { plateId: string; mode?: PlateMode; onClose: () => void }) {
  const { t } = useI18n()
  const copy = t.plates
  const workspaceSlug = useWorkspaceSlug()
  const plates = useQuery(platesQuery(workspaceSlug))
  const plate = plates.data?.plates.find(({ id }) => id === plateId)
  const [mode, setMode] = useState<PlateMode>(initialMode)
  if (!plate) {
    return (
      <DialogShell onClose={onClose} title={copy.open} className="sm:max-w-[420px]">
        {plates.isPending ? (
          <Spinner />
        ) : (
          <p className="text-sm text-muted-foreground">{plates.error ? copy.dialog.loadError : copy.dialog.missing}</p>
        )}
      </DialogShell>
    )
  }
  return mode === 'view' ? (
    <PlateSummary plate={plate} onRecord={setMode} onClose={onClose} />
  ) : (
    <PlateRecorder plate={plate} mode={mode} onModeChange={setMode} onClose={onClose} />
  )
}

function PlateSummary({ plate, onRecord, onClose }: { plate: PlateView; onRecord: (mode: PlateMode) => void; onClose: () => void }) {
  const { t, locale } = useI18n()
  const copy = t.plates
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const printer = useQuery(printersQuery(workspaceSlug)).data?.profiles.find(({ id }) => id === plate.printerId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const callDelete = useServerFn(deletePlate)
  const remove = useMutation({
    mutationFn: () => callDelete({ data: { workspaceSlug, plateId: plate.id } }),
    onSuccess: () => {
      toast(copy.dialog.deleted)
      void invalidateQueries(queryClient, 'plates', 'usage', 'stock')
      onClose()
    },
  })
  const recording = plate.recording
  const amount = (value: number, unit: UsageUnit) => formatUsageAmount(value, unit, t.spend, locale)
  const materials = recording?.materials ?? []
  const otherMinutes = recording ? recording.minutes - plate.items.reduce((total, item) => total + (item.minutes ?? 0), 0) : 0
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <DialogShell
      onClose={onClose}
      title={copy.name(plate.number)}
      description={[printer?.name, when.format(plate.createdAt)].filter(Boolean).join(' · ')}
      focusDialog
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="mr-auto text-destructive hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            {copy.dialog.delete}
          </Button>
          <Button type="button" variant="outline" onClick={() => onRecord('totals')}>
            {recording ? copy.dialog.replaceTotals : copy.enterTotals}
          </Button>
          {plate.printType !== 'resin' && (
            <Button type="button" onClick={() => onRecord('file')}>
              <FileUp />
              {recording ? copy.dialog.replaceFile : copy.uploadFile}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {!recording && <p className="min-w-48 flex-1 text-sm text-muted-foreground">{copy.dialog.notRecorded}</p>}
        <PlateSlicerButton plate={plate} size="sm" />
      </div>
      <table className="w-full text-sm" data-plate-prints>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-full py-1.5 font-medium">{copy.dialog.print}</th>
            {recording && <th className="py-1.5 pl-3 text-right font-medium">{copy.dialog.used}</th>}
            {recording && <th className="py-1.5 pl-3 text-right font-medium max-sm:hidden">{copy.dialog.time}</th>}
          </tr>
        </thead>
        <tbody>
          {plate.items.map((item) => (
            <tr key={item.requestId} className="border-b border-border/60 last:border-0">
              <td className="max-w-0 py-1.5">
                <span className="block truncate font-medium">{item.name}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">×{item.copies}</span>
                  {recording &&
                    materials.length > 1 &&
                    materials.map((material) => (
                      <span key={material.name}>
                        {' · '}
                        {material.name}{' '}
                        <span className="whitespace-nowrap tabular-nums">
                          {amount(material.prints[item.requestId] ?? 0, recording.unit)}
                        </span>
                      </span>
                    ))}
                </span>
              </td>
              {recording && (
                <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap tabular-nums">
                  {amount(item.amount ?? 0, recording.unit)}
                </td>
              )}
              {recording && (
                <td className="py-1.5 pl-3 text-right whitespace-nowrap text-muted-foreground tabular-nums max-sm:hidden">
                  {amount(item.minutes ?? 0, 'minute')}
                </td>
              )}
            </tr>
          ))}
          {recording && recording.otherAmount > 0 && (
            <tr className="text-muted-foreground">
              <td className="py-1.5 italic">{copy.dialog.other}</td>
              <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap tabular-nums">
                {amount(recording.otherAmount, recording.unit)}
              </td>
              <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums max-sm:hidden">
                {amount(Math.max(0, otherMinutes), 'minute')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {recording && materials.length > 0 && (
        <Section title={copy.dialog.materials}>
          <ul className="flex flex-col text-sm" data-plate-materials>
            {materials.map((material) => (
              <li key={material.name} className="flex items-center gap-2 border-b border-border/60 py-1 last:border-0">
                {material.hex && <ColourSwatch hex={material.hex} />}
                <span className="min-w-0 flex-1 truncate">{material.name}</span>
                <span className="font-mono whitespace-nowrap tabular-nums">{amount(material.amount, recording.unit)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {plate.print && (
        <p
          className={cn(
            'text-xs',
            plate.print.outcome === 'failed' || plate.print.outcome === 'cancelled' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {copy.dialog.reported(copy.outcome[plate.print.outcome], when.format(plate.print.receivedAt))}
        </p>
      )}
      {recording && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {[
            copy.dialog.source[recording.source],
            copy.dialog.method[recording.method],
            copy.dialog.recordedAt(when.format(recording.recordedAt)),
          ].join(' · ')}
          {recording.overheadAmount > 0.005 && (
            <span className="block">{copy.dialog.overhead(amount(recording.overheadAmount, recording.unit))}</span>
          )}
        </p>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={copy.dialog.delete}
        description={copy.dialog.deleteConfirm}
        confirmLabel={copy.dialog.delete}
        destructive
        pending={remove.isPending}
        problem={{
          title: copy.dialog.deleteFailed,
          hint: copy.dialog.deleteConfirm,
          error: remove.error ? errorMessage(remove.error, copy.dialog.deleteFailed) : undefined,
        }}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </DialogShell>
  )
}

type Parsed = { plates: SlicedPlate[]; index: number; assignments: (string | undefined)[] }

function PlateRecorder({
  plate,
  mode,
  onModeChange,
  onClose,
}: {
  plate: PlateView
  mode: Exclude<PlateMode, 'view'>
  onModeChange: (mode: PlateMode) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const copy = t.plates
  const id = useId()
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const library = useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? []
  const filamentCatalogue = useQuery({ ...catalogueQuery('filaments'), enabled: plate.printType !== 'resin' }).data
  const printType: PrintType = plate.printType ?? 'filament'
  const unit = printType === 'resin' ? 'ml' : 'g'
  const [parsed, setParsed] = useState<Parsed>()
  const [reading, setReading] = useState(false)
  const [unreadable, setUnreadable] = useState(false)
  const [unlabelled, setUnlabelled] = useState(false)
  const [materials, setMaterials] = useState<MaterialDraft[]>([{}])
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [amounts, setAmounts] = useState<string[]>([''])
  const [otherShare, setOtherShare] = useState('')
  const sliced = parsed?.plates[parsed.index]

  const presetTypes = new Map((filamentCatalogue ?? []).flatMap((preset) => (preset.type ? [[preset.id, preset.type] as const] : [])))
  const choose = (next: Parsed) => {
    const chosen = next.plates[next.index]
    setParsed(next)
    setMaterials(
      chosen.filaments.map((filament) => {
        const consumableId = suggestedFilament(library, filament, presetTypes)
        return consumableId ? { consumableId } : {}
      }),
    )
    if (chosen.minutes !== undefined) {
      const rounded = Math.round(chosen.minutes)
      setHours(String(Math.floor(rounded / 60)))
      setMinutes(String(rounded % 60))
    }
    // A file without object labels still knows the plate's total, which is then split like typed totals.
    const labelled = chosen.objects.length > 0
    setUnlabelled(!labelled)
    if (!labelled) {
      setAmounts([chosen.slicerGrams === undefined ? '' : String(chosen.slicerGrams)])
      setMaterials([{}])
      onModeChange('totals')
    }
  }
  const readFile = async (file: File) => {
    setReading(true)
    setUnreadable(false)
    try {
      const plates = readSlicedFile(new Uint8Array(await file.arrayBuffer()), file.name)
      const first = plates[0]
      choose({ plates, index: 0, assignments: matchSlicedObjects(first.objects, plate.items.map(printOf)) })
    } catch {
      setUnreadable(true)
    } finally {
      setReading(false)
    }
  }

  const time = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
  const choices = materials.map((draft) => plateMaterialChoice(draft))
  const measuredInput: PlateMeasured | undefined =
    mode === 'file' && sliced && parsed ? measuredRecord(plate.id, sliced, parsed.assignments, [], time) : undefined
  const totalsProblem = plateTotalsProblem(choices.map((material, slot) => ({ material, amount: Number(amounts[slot]) })))
  const totalsInput: PlateTotals | undefined =
    mode === 'totals' && !totalsProblem
      ? {
          totals: amounts.map(Number),
          otherShare: plate.otherStuff ? Math.min(0.99, Math.max(0, Number(otherShare) || 0) / 100) : 0,
        }
      : undefined
  const input = measuredInput ?? totalsInput
  const split = input
    ? splitPlate(
        input,
        time,
        plate.items.map(({ requestId, copies, volumeMm3, estimatedMaterial }) => ({ requestId, copies, volumeMm3, estimatedMaterial })),
        materials.length,
      )
    : undefined
  const ready = Boolean(input) && choices.every((choice) => choice !== undefined)

  const callRecord = useServerFn(recordPlate)
  const callUndo = useServerFn(undoUsage)
  const record = useMutation({
    mutationFn: () => {
      const recorded = choices as PlateMaterialChoice[]
      return callRecord({
        data:
          measuredInput && sliced && parsed
            ? { workspaceSlug, ...measuredRecord(plate.id, sliced, parsed.assignments, recorded, time) }
            : { workspaceSlug, plateId: plate.id, minutes: time, materials: recorded, ...totalsInput! },
      })
    },
    onSuccess: ({ transactionId }) => {
      void invalidateQueries(queryClient, 'plates', 'usage', 'stock', 'consumables', 'usage-backfill')
      toast.success(copy.recorded(plate.items.length), {
        action: {
          label: copy.undo,
          onClick: () =>
            void callUndo({ data: { workspaceSlug, transactionId } }).then(
              () => {
                toast(copy.undone)
                void invalidateQueries(queryClient, 'plates', 'usage', 'stock')
              },
              () => toast.error(copy.undoFailed),
            ),
        },
      })
      onModeChange('view')
    },
  })

  const amount = (value: number) => formatUsageAmount(value, unit, t.spend, locale)
  const slotLabel = (index: number) =>
    materials.length > 1
      ? mode === 'file'
        ? `${copy.material.label} · ${copy.file.filament(index)}`
        : copy.file.filament(index)
      : copy.material.label
  const materialName = (index: number) => {
    const draft = materials[index]
    return library.find((consumable) => consumable.id === draft?.consumableId)?.name ?? draft?.name?.trim() ?? copy.file.filament(index)
  }
  const removeSlot = (index: number) => {
    setMaterials(materials.filter((_, position) => position !== index))
    setAmounts(amounts.filter((_, position) => position !== index))
  }
  const assignmentOptions = [
    ...plate.items.map((item) => ({ value: item.requestId, label: item.name })),
    { value: NOT_IN_STL_QUEST, label: copy.dialog.other },
  ]
  return (
    <DialogShell
      onClose={onClose}
      title={copy.name(plate.number)}
      description={mode === 'file' ? copy.file.hint : copy.dialog.notRecorded}
      className="sm:max-w-[640px]"
      preventClose={record.isPending}
      footer={
        <>
          <Button type="button" variant="outline" disabled={record.isPending} onClick={() => onModeChange('view')}>
            {t.common.cancel}
          </Button>
          <Button type="button" disabled={!ready || record.isPending} onClick={() => record.mutate()}>
            {record.isPending && <Spinner />}
            {record.isPending ? copy.recording : copy.record}
          </Button>
        </>
      }
    >
      {mode === 'file' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".3mf,.gcode,.g"
            className="sr-only"
            aria-label={copy.uploadFile}
            data-plate-file
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void readFile(file)
              event.target.value = ''
            }}
          />
          <Button type="button" variant="outline" disabled={reading} onClick={() => fileInput.current?.click()}>
            {reading ? <Spinner /> : <FileUp />}
            {reading ? copy.file.reading : copy.file.choose}
          </Button>
          {parsed && parsed.plates.length > 1 && (
            <Select
              items={parsed.plates.map(({ index }) => ({ value: String(index), label: copy.name(index) }))}
              value={String(parsed.plates[parsed.index].index)}
              onValueChange={(value) => {
                const index = parsed.plates.findIndex((candidate) => String(candidate.index) === value)
                if (index >= 0)
                  choose({ ...parsed, index, assignments: matchSlicedObjects(parsed.plates[index].objects, plate.items.map(printOf)) })
              }}
            >
              <SelectTrigger aria-label={copy.file.plateInFile} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {parsed.plates.map(({ index }) => (
                  <SelectItem key={index} value={String(index)}>
                    {copy.name(index)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
      {unreadable && <p className="text-sm text-destructive">{copy.file.unreadable}</p>}
      {mode === 'totals' && unlabelled && <p className="text-sm text-muted-foreground">{copy.file.unlabelled}</p>}

      {mode === 'file' && sliced && parsed && (
        <section className="flex flex-col gap-2">
          <h3 className="font-heading text-xs font-bold tracking-[0.015em] text-muted-foreground uppercase">{copy.file.objects}</h3>
          <p className="-mt-1 text-xs text-muted-foreground">{copy.file.objectsHint}</p>
          <ul className="flex flex-col" data-plate-objects>
            {sliced.objects.map((object, index) => {
              const label = slicedObjectLabel(object, copy.file.unnamed)
              return (
                <li
                  key={object.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border/60 py-1.5 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto_14rem]"
                >
                  <span className="truncate text-sm" title={label}>
                    {label}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {amount(object.grams.reduce((sum, grams) => sum + grams, 0))}
                  </span>
                  <Select
                    items={assignmentOptions}
                    value={parsed.assignments[index] ?? NOT_IN_STL_QUEST}
                    onValueChange={(value) =>
                      setParsed({
                        ...parsed,
                        assignments: parsed.assignments.map((assigned, position) =>
                          position === index ? (value && value !== NOT_IN_STL_QUEST ? value : undefined) : assigned,
                        ),
                      })
                    }
                  >
                    <SelectTrigger className="col-span-2 w-full sm:col-span-1" aria-label={label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assignmentOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              )
            })}
          </ul>
          {sliced.slicerGrams !== undefined && (
            <p className="text-xs text-muted-foreground">
              {copy.file.check(
                amount(
                  sliced.objects.reduce((sum, object) => sum + object.grams.reduce((all, grams) => all + grams, 0), 0) +
                    sliced.overhead.reduce((sum, grams) => sum + grams, 0),
                ),
                amount(sliced.slicerGrams),
              )}
            </p>
          )}
        </section>
      )}

      {mode === 'totals' && (
        <section className="flex flex-col gap-3" data-plate-totals>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-xs font-bold tracking-[0.015em] text-muted-foreground uppercase">{copy.totals.material}</h3>
            {printType === 'filament' && materials.length < MAX_PLATE_FILAMENTS && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMaterials([...materials, {}])
                  setAmounts([...amounts, ''])
                }}
              >
                <Plus />
                {copy.totals.addFilament}
              </Button>
            )}
          </div>
          {materials.map((draft, index) => (
            <PlateMaterialField
              // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own until a material is chosen
              key={index}
              label={slotLabel(index)}
              printType={printType}
              library={library}
              value={draft}
              onChange={(next) => setMaterials(materials.map((current, position) => (position === index ? next : current)))}
              trailing={
                <>
                  <UnitInput
                    unit={unit === 'ml' ? 'mL' : 'g'}
                    className="w-28"
                    aria-label={copy.totals.amount(slotLabel(index))}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={amounts[index] ?? ''}
                    onChange={(event) =>
                      setAmounts(amounts.map((current, position) => (position === index ? event.target.value : current)))
                    }
                  />
                  {materials.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={copy.totals.remove(slotLabel(index))}
                      onClick={() => removeSlot(index)}
                    >
                      <X />
                    </Button>
                  )}
                </>
              }
            />
          ))}
          {totalsProblem === 'duplicate' && <p className="text-sm text-destructive">{copy.totals.duplicate}</p>}
        </section>
      )}

      {(mode === 'totals' || sliced) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-hours`}>{copy.totals.time}</FieldLabel>
            <div className="flex gap-2">
              <UnitInput
                unit="h"
                id={`${id}-hours`}
                aria-label={copy.totals.hours}
                type="number"
                inputMode="numeric"
                min={0}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
              <UnitInput
                unit="min"
                aria-label={copy.totals.minutes}
                type="number"
                inputMode="numeric"
                min={0}
                max={59}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </div>
          </Field>
          {mode === 'totals' && plate.otherStuff && (
            <Field>
              <FieldLabel htmlFor={`${id}-other`}>{copy.totals.otherShare}</FieldLabel>
              <UnitInput
                unit="%"
                id={`${id}-other`}
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={otherShare}
                onChange={(event) => setOtherShare(event.target.value)}
              />
              <FieldDescription>{copy.totals.otherShareHint}</FieldDescription>
            </Field>
          )}
        </div>
      )}

      {mode === 'file' &&
        sliced &&
        materials.map((draft, index) => (
          <PlateMaterialField
            // eslint-disable-next-line react/no-array-index-key -- one field per filament slot, which never reorder
            key={index}
            label={slotLabel(index)}
            printType={printType}
            library={library}
            fromFile={sliced?.filaments[index]}
            value={draft}
            onChange={(next) => setMaterials(materials.map((current, position) => (position === index ? next : current)))}
          />
        ))}

      {split && (
        <Section title={copy.totals.split}>
          <ul className="flex flex-col text-sm" data-plate-split>
            {split.prints.map((print) => (
              <li key={print.requestId} className="flex items-baseline gap-2 border-b border-border/60 py-1 last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{plate.items.find(({ requestId }) => requestId === print.requestId)?.name}</span>
                  {mode === 'totals' && print.amounts.length > 1 && (
                    <span className="block text-xs text-muted-foreground">
                      {print.amounts.map((value, slot) => `${materialName(slot)} ${amount(value)}`).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums">{amount(print.amounts.reduce((sum, value) => sum + value, 0))}</span>
              </li>
            ))}
            {split.other.amounts.some((value) => value > 0) && (
              <li className="flex items-baseline gap-2 py-1 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate italic">{copy.dialog.other}</span>
                <span className="font-mono tabular-nums">{amount(split.other.amounts.reduce((sum, value) => sum + value, 0))}</span>
              </li>
            )}
          </ul>
          <p className="text-xs text-muted-foreground">{copy.dialog.method[split.method]}</p>
        </Section>
      )}
      <DialogProblem
        title={copy.recordFailed}
        hint={copy.dialog.notRecorded}
        error={record.error ? errorMessage(record.error, copy.recordFailed) : undefined}
      />
    </DialogShell>
  )
}

function printOf(item: PlateView['items'][number]) {
  return { requestId: item.requestId, number: item.number, name: item.name, fileName: item.fileName }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="font-heading text-xs font-bold tracking-[0.015em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function UnitInput({ unit, className, ...props }: ComponentProps<'input'> & { unit: string }) {
  return (
    <InputGroup className={className}>
      <InputGroupInput {...props} />
      <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>
    </InputGroup>
  )
}
