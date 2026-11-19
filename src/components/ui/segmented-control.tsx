import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean; title?: string; id?: string }

/**
 * A choice between a few modes. Choosing a mode never commits anything, so the selected segment is
 * raised on a recess fill rather than amber.
 */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
  size = 'default',
  className,
}: {
  legend: string
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  size?: 'default' | 'xs'
  className?: string
}) {
  return (
    <fieldset
      data-slot="segmented-control"
      className={cn('m-0 flex min-w-0 rounded-lg border border-input bg-background', size === 'xs' ? 'p-0.5' : 'p-1', className)}
    >
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <Button
          key={option.value}
          id={option.id}
          type="button"
          size={size === 'xs' ? 'xs' : 'default'}
          variant={value === option.value ? 'secondary' : 'ghost'}
          className={cn('min-w-0', size === 'default' && 'flex-1')}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </fieldset>
  )
}
