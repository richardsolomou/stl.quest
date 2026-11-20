import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import type { PublicPrintRequest } from '../../core/types'
import { setRequestCharge } from '../../server/fns'
import { useI18n } from '../i18n'
import { priceCalculatorSettingsQuery } from '../queries'
import { invalidateQueries } from '../queryState'
import { useWorkspaceSlug } from '../workspace'
import { DetailRow } from './DetailRow'

/** Admin-only: what the print was charged, saved as soon as the field is left; blank means not recorded. */
export function RequestCharge({ request }: { request: PublicPrintRequest }) {
  const { t, locale } = useI18n()
  const copy = t.requests.charge
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const currency = useQuery(priceCalculatorSettingsQuery(workspaceSlug)).data?.settings.currency
  const stored = request.charged?.currency === currency ? request.charged?.amount : undefined
  const [value, setValue] = useState(stored === undefined ? '' : String(stored))
  const callSave = useServerFn(setRequestCharge)
  const save = useMutation({
    mutationFn: (amount: number | null) => callSave({ data: { workspaceSlug, id: request.id, amount } }),
    onSuccess: () => void invalidateQueries(queryClient, 'requests'),
    onError: () => void toast.error(copy.failed),
  })
  if (!currency) return null
  const commit = () => {
    const amount = value.trim() === '' ? null : Number(value)
    if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return
    if ((amount ?? undefined) !== stored) save.mutate(amount)
  }
  const symbol = new Intl.NumberFormat(locale, { style: 'currency', currency })
    .formatToParts(0)
    .find(({ type }) => type === 'currency')?.value
  return (
    <DetailRow label={copy.label}>
      <InputGroup className="max-w-40">
        <InputGroupAddon>{symbol}</InputGroupAddon>
        <InputGroupInput
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          aria-label={copy.label}
          placeholder={copy.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </InputGroup>
      <p className="mt-1 text-xs text-muted-foreground">{copy.hint}</p>
    </DetailRow>
  )
}
