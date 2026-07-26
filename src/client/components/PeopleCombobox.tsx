import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export function PeopleCombobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select a person',
  emptyLabel = 'No people found.',
}: {
  id?: string
  value?: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  emptyLabel?: string
}) {
  const selectedOption = options.find((option) => option.value === value)

  return (
    <Combobox
      value={selectedOption ?? null}
      onValueChange={(next: { value: string; label: string } | null) => next && onChange(next.value)}
      items={options}
    >
      <ComboboxInput id={id} className="ph-no-capture w-full" placeholder={placeholder} showClear={false} />
      <ComboboxContent className="ph-no-capture">
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(option: { value: string; label: string }) => (
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
