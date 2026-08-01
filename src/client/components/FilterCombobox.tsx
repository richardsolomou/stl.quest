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
export function FilterCombobox({
  id,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  redacted = false,
}: {
  id?: string
  ariaLabel?: string
  value?: string
  onChange: (value?: string) => void
  options: Option[]
  placeholder: string
  emptyLabel: string
  redacted?: boolean
}) {
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Combobox value={selected} onValueChange={(next: Option | null) => onChange(next?.value)} items={options}>
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
            {(option: Option) => (
              <ComboboxItem key={option.value} value={option}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
