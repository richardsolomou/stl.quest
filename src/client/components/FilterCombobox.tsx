import type { ReactNode } from 'react'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

type Option = { value: string; label: string }

/** Searchable single-select for the board filter panel; clearing it drops the filter. */
export function FilterCombobox<T extends Option>({
  id,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  redacted = false,
  renderOption,
  optionAriaLabel,
}: {
  id?: string
  ariaLabel?: string
  value?: string
  onChange: (value?: string) => void
  options: T[]
  placeholder: string
  emptyLabel: string
  redacted?: boolean
  /** Overrides how each dropdown row renders, e.g. to show a hierarchy instead of plain text. */
  renderOption?: (option: T) => ReactNode
  /** Overrides the option's accessible name; needed alongside `renderOption` when the visible text no longer disambiguates on its own. */
  optionAriaLabel?: (option: T) => string
}) {
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Combobox value={selected} onValueChange={(next: T | null) => onChange(next?.value)} items={options}>
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        className={cn('w-full', redacted && 'ph-no-capture')}
        placeholder={placeholder}
        showClear={selected !== null}
      />
      <ComboboxContent className={cn(redacted && 'ph-no-capture')}>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(option: T) => (
              <ComboboxItem key={option.value} value={option} aria-label={optionAriaLabel?.(option)}>
                {renderOption ? renderOption(option) : option.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
