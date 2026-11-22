import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '../../../core/error'
import { plateStart } from '../../../core/plates'
import type { PrinterProfile, PublicPrintRequest } from '../../../core/types'
import { createPlate } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { invalidateQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'

const NONE = 'none'

/**
 * Starts selected copies as one plate run on a printer, which moves them to Printing together, or, when every copy is
 * already past Printing, records the run they went on after the fact.
 */
export function PlanPlateDialog({
  copies,
  printers,
  onDone,
  onCancel,
}: {
  copies: { request: PublicPrintRequest; status: string; copies: number }[]
  printers: PrinterProfile[]
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const copy = t.plates
  const id = useId()
  const workspaceSlug = useWorkspaceSlug()
  const start = plateStart(copies.map(({ request, status, copies: count }) => ({ requestId: request.id, status, copies: count })))
  const running = Boolean(start?.stage)
  const printTypes = new Set(copies.flatMap(({ request }) => request.printType ?? []))
  const choices = printers.filter((printer) => !printer.archived && (printTypes.size !== 1 || printTypes.has(printer.printType)))
  const assigned = new Set(copies.map(({ request }) => request.printer?.id))
  const shared = assigned.size === 1 ? [...assigned][0] : undefined
  const [printerId, setPrinterId] = useState(
    choices.some(({ id: candidate }) => candidate === shared) ? shared : running && choices.length === 1 ? choices[0].id : undefined,
  )
  const printer = choices.find(({ id: candidate }) => candidate === printerId)
  const [otherStuff, setOtherStuff] = useState(false)
  const queryClient = useQueryClient()
  const callCreate = useServerFn(createPlate)
  const create = useMutation({
    mutationFn: () =>
      callCreate({
        data: {
          workspaceSlug,
          otherStuff,
          ...(printerId && { printerId }),
          items: copies.map(({ request, status, copies: count }) => ({ requestId: request.id, status, copies: count })),
        },
      }),
    onSuccess: (plate) => {
      void invalidateQueries(queryClient, 'plates', 'requests')
      toast.success(running && printer ? copy.run.started(plate.number, printer.name) : copy.plan.created(plate.number))
      onDone()
    },
  })
  const options = [
    ...(running ? [] : [{ value: NONE, label: copy.plan.noPrinter }]),
    ...choices.map(({ id: value, name: label }) => ({ value, label })),
  ]
  const prints = new Map<string, { name: string; copies: number }>()
  for (const { request, copies: count } of copies)
    prints.set(request.id, { name: request.name, copies: (prints.get(request.id)?.copies ?? 0) + count })
  const total = copies.reduce((sum, item) => sum + item.copies, 0)
  const disabled = create.isPending || !start || (running && !printer)
  return (
    <DialogShell
      onClose={onCancel}
      title={running ? copy.startPlate : copy.putOnPlate}
      description={running ? copy.run.description(prints.size, total) : copy.plan.description(prints.size, total)}
      className="sm:max-w-[420px]"
      preventClose={create.isPending}
      footer={
        <>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="button" disabled={disabled} onClick={() => create.mutate()}>
            {create.isPending && <Spinner />}
            {running
              ? create.isPending
                ? copy.run.starting
                : copy.run.start(printer?.name)
              : create.isPending
                ? copy.plan.creating
                : copy.plan.create}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col text-sm">
        {[...prints].map(([requestId, print]) => (
          <li key={requestId} className="flex items-baseline gap-2 border-b border-border/60 py-1.5 last:border-0">
            <span className="min-w-0 flex-1 truncate font-medium">{print.name}</span>
            <span className="font-mono text-xs text-muted-foreground">×{print.copies}</span>
          </li>
        ))}
      </ul>
      {start ? (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-printer`}>{copy.plan.printer}</FieldLabel>
            <Select
              items={options}
              value={printerId ?? (running ? null : NONE)}
              onValueChange={(value) => setPrinterId(value && value !== NONE ? value : undefined)}
            >
              <SelectTrigger className="w-full" id={`${id}-printer`}>
                <SelectValue placeholder={copy.run.choosePrinter} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>{running ? copy.run.printerHint : copy.run.past}</FieldDescription>
          </Field>
          <label className="flex items-start gap-2.5 text-sm" htmlFor={`${id}-other`}>
            <Checkbox id={`${id}-other`} className="mt-0.5" checked={otherStuff} onCheckedChange={setOtherStuff} />
            {copy.plan.otherStuff}
          </label>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{copy.run.mixed}</p>
      )}
      <DialogProblem
        title={copy.plan.failed}
        hint={copy.plan.failedHint}
        error={create.error ? errorMessage(create.error, copy.plan.failed) : undefined}
      />
    </DialogShell>
  )
}
