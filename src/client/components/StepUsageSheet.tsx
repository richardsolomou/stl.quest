import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Plus, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from '@/components/ui/combobox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EquipmentItem } from '../../core/equipment'
import type { PrinterSummary, PublicPrintRequest } from '../../core/types'
import { statusText } from '../../core/i18n'
import { recordStepUsage, undoUsage } from '../../server/fns'
import { consumablesQuery, equipmentQuery, stockQuery, usageQuery } from '../queries'
import {
  finishingGroups,
  finishingSettled,
  materialNeeded,
  prefillMaterial,
  printingGroups,
  printingSettled,
  stepUsageInputs,
  stockShortfalls,
  type FinishingGroup,
  type JobMaterial,
  type PrintingChoice,
  type PrintingGroup,
  type StepCatalog,
  type StepMove,
} from '../stepUsage'
import { useWorkspaceSlug } from '../workspace'
import { useI18n } from '../i18n'
import { ColourSwatch } from './ColourSwatch'
import { formatNumber } from './priceCalculator/format'

// Base UI reserves an empty value for no selection, so choosing nothing needs its own value.
const NONE = 'none'
const RECENT_USAGE = { limit: 500 }

type Shortfalls = ReturnType<typeof stockShortfalls>

/**
 * Asks what prints that just reached printing or finishing used, prefilled from the assignment and the usage log so one
 * Enter records it. It floats over the board without blocking it: moves made while it is open join it, Skip records
 * nothing, and a workspace with nothing to record for a step never sees it.
 */
export function StepUsageSheet({
  moves,
  requests,
  printers,
  raised = false,
  onDone,
}: {
  moves: StepMove[]
  requests: PublicPrintRequest[]
  printers: PrinterSummary[]
  /** Lifts the sheet clear of the selection bar while one is showing. */
  raised?: boolean
  onDone: () => void
}) {
  const { t } = useI18n()
  const copy = t.board.stepUsage
  const workspaceSlug = useWorkspaceSlug()
  const titleId = useId()
  const sheet = useRef<HTMLFormElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const consumables = useQuery(consumablesQuery(workspaceSlug))
  const equipment = useQuery(equipmentQuery(workspaceSlug))
  const usage = useQuery(usageQuery(workspaceSlug, RECENT_USAGE))
  const stock = useQuery(stockQuery(workspaceSlug))
  const loaded = !consumables.isPending && !equipment.isPending && !usage.isPending
  const catalog = useMemo<StepCatalog>(
    () => ({
      printers,
      consumables: consumables.data?.consumables ?? [],
      equipment: equipment.data?.equipment ?? [],
      events: usage.data?.events ?? [],
    }),
    [consumables.data, equipment.data, printers, usage.data],
  )
  const printing = useMemo(() => printingGroups(moves, requests, catalog), [catalog, moves, requests])
  const finishing = useMemo(() => finishingGroups(moves, requests, catalog), [catalog, moves, requests])
  // Only what the operator changed is stored, so prefills keep following the log until a field is touched.
  const [printingChanges, setPrintingChanges] = useState<Record<string, Partial<PrintingChoice>>>({})
  const [finishingChanges, setFinishingChanges] = useState<Record<string, string[]>>({})
  const printingChoices = printing.map((group) => ({ group, choice: printingChoice(group, catalog, printingChanges[group.key]) }))
  const finishingChoices = finishing.map((group) => ({ group, equipmentIds: finishingChanges[group.key] ?? group.equipmentIds }))
  const empty = loaded && printing.length === 0 && finishing.length === 0
  // A question with one answer is not asked: the step is recorded straight away, with Undo in the toast.
  const settled = loaded && !empty && printing.every(printingSettled) && finishing.every(finishingSettled)
  const shortfalls = stockShortfalls(
    printingChoices.flatMap(({ group, choice }) => {
      const material = group.materials.find(({ id }) => id === choice.consumableId)
      return material ? [{ consumableId: material.id, amount: materialNeeded(group.moves, material) }] : []
    }),
    stock.data?.stock ?? [],
  )
  const record = useStepUsageRecorder()

  useEffect(() => {
    if (empty) onDone()
  }, [empty, onDone])

  // Each new move refocuses Record, so Enter confirms whatever was just dropped unless a field here is in use.
  useEffect(() => {
    if (!loaded || empty || sheet.current?.contains(document.activeElement)) return
    confirm.current?.focus({ preventScroll: true })
  }, [empty, loaded, moves])

  const submit = useEffectEvent(() => {
    record(stepUsageInputs(printingChoices, finishingChoices))
    onDone()
  })

  const skip = useEffectEvent(onDone)

  useEffect(() => {
    if (settled) submit()
  }, [settled, moves])

  // Focus can land back on the page after a drag; Enter there still confirms, as long as nothing else holds focus. Escape
  // skips only from inside the sheet, and not while a picker is open: a native listener, since React would bubble it up
  // from the portalled pickers.
  useEffect(() => {
    if (!loaded || empty) return
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.defaultPrevented && document.activeElement === document.body) {
        event.preventDefault()
        submit()
      }
    }
    const onSheetKeyDown = (event: KeyboardEvent) => {
      const picking = event.target instanceof Element && event.target.closest('[aria-expanded="true"]')
      if (event.key === 'Escape' && !event.defaultPrevented && !picking) skip()
    }
    const element = sheet.current
    window.addEventListener('keydown', onWindowKeyDown)
    element?.addEventListener('keydown', onSheetKeyDown)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
      element?.removeEventListener('keydown', onSheetKeyDown)
    }
  }, [loaded, empty])

  if (!loaded || empty || settled) return null
  const asked = [...printing, ...finishing].flatMap((group) => group.moves)
  const prints = new Set(asked.map(({ request }) => request.id)).size
  const copies = asked.reduce((sum, move) => sum + move.copies, 0)

  return (
    <form
      ref={sheet}
      aria-labelledby={titleId}
      data-selection-controls
      className={cn(
        'fixed left-1/2 z-40 flex max-h-[min(36rem,calc(100dvh-11rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-3 rounded-lg border-t-6 border-shell bg-popover p-4 text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2',
        // Below md it sits above the feedback button and the selection bar, which share the bottom edge there.
        'bottom-34',
        raised ? 'md:bottom-18' : 'md:bottom-4',
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-3">
        <h2 id={titleId} className="font-heading text-base leading-tight font-extrabold uppercase">
          {copy.title}
        </h2>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{copy.summary(prints, copies)}</span>
      </header>
      <div className="app-scrollbar -mx-1 min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain px-1">
        {printingChoices.map(({ group, choice }) => (
          <PrintingStep
            key={`printing:${group.key}`}
            group={group}
            choice={choice}
            shortfalls={shortfalls}
            onChange={(change) => setPrintingChanges((current) => ({ ...current, [group.key]: { ...current[group.key], ...change } }))}
          />
        ))}
        {finishingChoices.map(({ group, equipmentIds }) => (
          <FinishingStep
            key={`finishing:${group.key}`}
            group={group}
            equipmentIds={equipmentIds}
            onChange={(ids) => setFinishingChanges((current) => ({ ...current, [group.key]: ids }))}
          />
        ))}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 max-sm:[&>*]:flex-1">
        <Button type="button" variant="outline" onClick={onDone}>
          {copy.skip}
        </Button>
        <Button ref={confirm} type="submit" aria-keyshortcuts="Enter">
          {copy.record}
          <kbd aria-hidden="true" className="font-mono text-[11px] opacity-70 max-sm:hidden">
            ↵
          </kbd>
        </Button>
      </footer>
    </form>
  )
}

/** The group's prefilled choice with the operator's changes on top; a new printer brings its own last material unless one was picked. */
function printingChoice(group: PrintingGroup, catalog: StepCatalog, change: Partial<PrintingChoice> = {}): PrintingChoice {
  const printerId = 'printerId' in change ? change.printerId : group.printerId
  const consumableId = 'consumableId' in change ? change.consumableId : prefillMaterial(group.printType, printerId, catalog)
  return { printerId, consumableId, equipmentIds: change.equipmentIds ?? [] }
}

function StepHeading({ step, moves }: { step: 'in_progress' | 'post_processing'; moves: PrintingGroup['moves'] }) {
  const { t } = useI18n()
  const names = moves.map(({ request, copies }) => (copies > 1 ? `${request.name} ×${copies}` : request.name)).join(', ')
  return (
    <p data-stage={step} className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px] bg-(--stage)" />
      <span className="shrink-0 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{statusText(t, 'label', step)}</span>
      <span className="min-w-0 truncate font-semibold" title={names}>
        {names}
      </span>
    </p>
  )
}

function PrintingStep({
  group,
  choice,
  shortfalls,
  onChange,
}: {
  group: PrintingGroup
  choice: PrintingChoice
  shortfalls: Shortfalls
  onChange: (change: Partial<PrintingChoice>) => void
}) {
  const { t, locale } = useI18n()
  const copy = t.board.stepUsage
  const id = useId()
  const material = group.materials.find((item) => item.id === choice.consumableId)
  // Prep kit is optional and rarely per print, so it stays a quiet link until asked for.
  const [preparing, setPreparing] = useState(choice.equipmentIds.length > 0)
  const shortfall = material ? shortfalls.get(material.id) : undefined
  const amount = (value: number) => `${formatNumber(value, locale, 0)} ${shortfall?.unit}`
  const printerOptions = [{ value: NONE, label: copy.none }, ...group.printers.map(({ id: value, name }) => ({ value, label: name }))]
  const materialOptions = [
    { value: NONE, label: copy.none, hex: undefined as string | undefined },
    ...group.materials.map((item) => ({ value: item.id, label: item.name, hex: swatchOf(item) })),
  ]
  return (
    <section className="space-y-2 py-3 first:pt-0 last:pb-0">
      <StepHeading step="in_progress" moves={group.moves} />
      <div className="grid gap-2 sm:grid-cols-2">
        {(group.printerChosen || group.printers.length === 1) && (
          <Fixed
            label={copy.printer}
            value={group.printers.find((printer) => printer.id === group.printerId)?.name ?? group.printers[0].name}
          />
        )}
        {!group.printerChosen && group.printers.length > 1 && (
          <Field>
            <FieldLabel htmlFor={`${id}-printer`}>{copy.printer}</FieldLabel>
            <Select
              items={printerOptions}
              value={choice.printerId ?? NONE}
              onValueChange={(value) => onChange({ printerId: value && value !== NONE ? value : undefined })}
            >
              <SelectTrigger className="w-full" id={`${id}-printer`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {printerOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {group.materials.length === 1 && (
          <Fixed label={copy.material} value={group.materials[0].name} swatch={swatchOf(group.materials[0])} />
        )}
        {group.materials.length > 1 && (
          <Field>
            <FieldLabel htmlFor={`${id}-material`}>{copy.material}</FieldLabel>
            <Select
              items={materialOptions}
              value={choice.consumableId ?? NONE}
              onValueChange={(value) => onChange({ consumableId: value && value !== NONE ? value : undefined })}
            >
              <SelectTrigger className="w-full" id={`${id}-material`}>
                <SelectValue>
                  {material && swatchOf(material) && <ColourSwatch hex={swatchOf(material)!} />}
                  <span className="truncate">{material?.name ?? copy.none}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {materialOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.hex && <ColourSwatch hex={option.hex} className="self-center" />}
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {group.preparation.length > 0 && !preparing && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="justify-self-start text-muted-foreground sm:col-span-2"
            onClick={() => setPreparing(true)}
          >
            <Plus aria-hidden="true" />
            {copy.preparation}
          </Button>
        )}
        {preparing && (
          <EquipmentField
            id={`${id}-preparation`}
            label={copy.preparation}
            equipment={group.preparation}
            chosenIds={choice.equipmentIds}
            onChange={(equipmentIds) => onChange({ equipmentIds })}
          />
        )}
      </div>
      {shortfall && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-(--tag-amber)" />
          {copy.shortfall(amount(shortfall.onHand), amount(shortfall.needed))}
        </p>
      )}
    </section>
  )
}

function FinishingStep({
  group,
  equipmentIds,
  onChange,
}: {
  group: FinishingGroup
  equipmentIds: string[]
  onChange: (equipmentIds: string[]) => void
}) {
  const copy = useI18n().t.board.stepUsage
  const id = useId()
  return (
    <section className="space-y-2 py-3 first:pt-0 last:pb-0">
      <StepHeading step="post_processing" moves={group.moves} />
      <EquipmentField
        id={`${id}-equipment`}
        label={copy.equipment}
        equipment={group.equipment}
        chosenIds={equipmentIds}
        onChange={onChange}
      />
    </section>
  )
}

function EquipmentField({
  id,
  label,
  equipment,
  chosenIds,
  onChange,
}: {
  id: string
  label: string
  equipment: EquipmentItem[]
  chosenIds: string[]
  onChange: (equipmentIds: string[]) => void
}) {
  const copy = useI18n().t.board.stepUsage
  const anchor = useComboboxAnchor()
  const chosen = equipment.filter((item) => chosenIds.includes(item.id))
  return (
    <Field className="sm:col-span-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox
        multiple
        items={equipment}
        value={chosen}
        itemToStringLabel={(item: EquipmentItem) => item.name}
        onValueChange={(next: EquipmentItem[]) => onChange(next.map((item) => item.id))}
      >
        <ComboboxChips ref={anchor}>
          {chosen.map((item) => (
            <ComboboxChip key={item.id} title={item.name}>
              {item.name}
            </ComboboxChip>
          ))}
          <ComboboxChipsInput id={id} placeholder={chosen.length ? undefined : copy.addEquipment} />
        </ComboboxChips>
        <ComboboxContent anchor={anchor}>
          <ComboboxEmpty>{copy.noMatches}</ComboboxEmpty>
          <ComboboxList>
            <ComboboxCollection>
              {(item: EquipmentItem) => (
                <ComboboxItem key={item.id} value={item} aria-label={item.name}>
                  {item.name}
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  )
}

/** A choice with only one answer reads as text, not as a picker. */
function Fixed({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {swatch && <ColourSwatch hex={swatch} />}
        <span className="truncate">{value}</span>
      </span>
    </div>
  )
}

function swatchOf(material: JobMaterial) {
  return material.kind === 'filament' ? material.colour?.hex : undefined
}

/** Records each print's usage in the background and offers to undo the lot, so confirming never waits on the server. */
function useStepUsageRecorder() {
  const copy = useI18n().t.board.stepUsage
  const workspaceSlug = useWorkspaceSlug()
  const callRecord = useServerFn(recordStepUsage)
  const callUndo = useServerFn(undoUsage)
  // The sheet floats at the bottom of the board, so its outcomes toast from the top instead of over its Record button.
  const above = { position: 'top-center' } as const
  return (inputs: ReturnType<typeof stepUsageInputs>) => {
    if (!inputs.length) return
    void Promise.allSettled(inputs.map((input) => callRecord({ data: { workspaceSlug, ...input } }))).then((results) => {
      const transactionIds = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value.transactionId ? [result.value.transactionId] : [],
      )
      if (results.some((result) => result.status === 'rejected')) toast.error(copy.recordFailed, above)
      if (!transactionIds.length) return
      const prints = new Set(inputs.filter((_, index) => results[index].status === 'fulfilled').map(({ requestId }) => requestId)).size
      toast.success(copy.recorded(prints), {
        ...above,
        action: {
          label: copy.undo,
          onClick: () =>
            void Promise.all(transactionIds.map((transactionId) => callUndo({ data: { workspaceSlug, transactionId } }))).then(
              () => toast(copy.undone, above),
              () => toast.error(copy.undoFailed, above),
            ),
        },
      })
    })
  }
}
