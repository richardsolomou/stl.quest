import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { errorMessage } from '../../../core/error'
import type { PrinterProfile, PublicPrintRequest } from '../../../core/types'
import { createPlate } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { invalidateQueries } from '../../queryState'
import { useWorkspaceSlug } from '../../workspace'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'

const NONE = 'none'

/** Records which selected copies went on one run, on the printer they share unless the operator picks another. */
export function PlanPlateDialog({
  prints,
  printers,
  onDone,
  onCancel,
}: {
  prints: { request: PublicPrintRequest; copies: number }[]
  printers: PrinterProfile[]
  onDone: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const copy = t.plates
  const id = useId()
  const workspaceSlug = useWorkspaceSlug()
  const printTypes = new Set(prints.flatMap(({ request }) => request.printType ?? []))
  const choices = printers.filter((printer) => !printer.archived && (printTypes.size !== 1 || printTypes.has(printer.printType)))
  const assigned = new Set(prints.map(({ request }) => request.printer?.id))
  const shared = assigned.size === 1 ? [...assigned][0] : undefined
  const [printerId, setPrinterId] = useState(choices.some(({ id: candidate }) => candidate === shared) ? shared : undefined)
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
          items: prints.map(({ request, copies }) => ({ requestId: request.id, copies })),
        },
      }),
    onSuccess: (plate) => {
      void invalidateQueries(queryClient, 'plates')
      toast.success(copy.plan.created(plate.number))
      onDone()
    },
  })
  const options = [{ value: NONE, label: copy.plan.noPrinter }, ...choices.map(({ id: value, name: label }) => ({ value, label }))]
  const copies = prints.reduce((total, print) => total + print.copies, 0)
  return (
    <DialogShell
      onClose={onCancel}
      title={copy.putOnPlate}
      description={copy.plan.description(prints.length, copies)}
      className="sm:max-w-[420px]"
      preventClose={create.isPending}
      footer={
        <>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="button" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Spinner />}
            {create.isPending ? copy.plan.creating : copy.plan.create}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col text-sm">
        {prints.map(({ request, copies: count }) => (
          <li key={request.id} className="flex items-baseline gap-2 border-b border-border/60 py-1.5 last:border-0">
            <span className="min-w-0 flex-1 truncate font-medium">{request.name}</span>
            <span className="font-mono text-xs text-muted-foreground">×{count}</span>
          </li>
        ))}
      </ul>
      <Field>
        <FieldLabel htmlFor={`${id}-printer`}>{copy.plan.printer}</FieldLabel>
        <Select
          items={options}
          value={printerId ?? NONE}
          onValueChange={(value) => setPrinterId(value && value !== NONE ? value : undefined)}
        >
          <SelectTrigger className="w-full" id={`${id}-printer`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-start gap-2.5 text-sm" htmlFor={`${id}-other`}>
        <Checkbox id={`${id}-other`} className="mt-0.5" checked={otherStuff} onCheckedChange={setOtherStuff} />
        {copy.plan.otherStuff}
      </label>
      <DialogProblem
        title={copy.plan.failed}
        hint={copy.plan.failedHint}
        error={create.error ? errorMessage(create.error, copy.plan.failed) : undefined}
      />
    </DialogShell>
  )
}
