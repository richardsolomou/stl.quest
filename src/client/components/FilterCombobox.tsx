import { useState, type ReactNode } from 'react'
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
  search,
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
  /** Replaces the built-in substring filter; `notice` renders above the results. */
  search?: (query: string) => { options: T[]; notice?: ReactNode }
}) {
  const selected = options.find((option) => option.value === value) ?? null
  const [query, setQuery] = useState(selected?.label ?? '')
  const searched = search?.(query)

  return (
    <Combobox
      value={selected}
      onValueChange={(next: T | null) => onChange(next?.value)}
      items={options}
      isItemEqualToValue={(item: T, current: T) => item.value === current.value}
      filteredItems={searched?.options}
      onInputValueChange={setQuery}
    >
      <ComboboxInput
        id={id}
        aria-label={ariaLabel}
        className={cn('w-full', redacted && 'ph-no-capture')}
        placeholder={placeholder}
        showClear={selected !== null}
      />
      <ComboboxContent className={cn(redacted && 'ph-no-capture')}>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        {searched?.notice && <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">{searched.notice}</p>}
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
