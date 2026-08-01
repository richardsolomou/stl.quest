import { useMemo } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PrintGroupRow } from '../../core/printGroups'

/** Empty string stands for the top level, because a select cannot hold an undefined value. */
export function TagParentSelect({
  id,
  value,
  rows,
  disabled,
  ariaLabel,
  className,
  onChange,
}: {
  id?: string
  value: string
  rows: PrintGroupRow[]
  disabled?: boolean
  ariaLabel: string
  className?: string
  onChange: (parentId: string) => void
}) {
  const items = useMemo(() => [{ value: '', label: 'Top level' }, ...rows.map((row) => ({ value: row.group.id, label: row.path }))], [rows])
  return (
    <Select items={items} value={value} disabled={disabled} onValueChange={(next: string | null) => onChange(next ?? '')}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
