import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useI18n } from '../../i18n'

export type SetupMode = 'preset' | 'custom'

export function ModeSelector({ legend, value, onChange }: { legend: string; value: SetupMode; onChange: (value: SetupMode) => void }) {
  const { t } = useI18n()
  return (
    <SegmentedControl
      legend={legend}
      size="xs"
      value={value}
      options={(['preset', 'custom'] as const).map((option) => ({
        value: option,
        label: <span className="capitalize">{t.calculator.modes[option]}</span>,
      }))}
      onChange={onChange}
    />
  )
}

export function NumberSetting({
  id: givenId,
  label,
  value,
  min,
  max,
  whole = false,
  description,
  onChange,
}: {
  /** Needed when the label alone repeats on the page. */
  id?: string
  label: string
  value: number
  min: number
  max?: number
  whole?: boolean
  description?: ReactNode
  onChange: (value: number) => void
}) {
  const { t, locale } = useI18n()
  const id = givenId ?? settingId(label)
  const outOfRange = value < min || (max !== undefined && value > max) || (whole && !Number.isInteger(value))
  return (
    <Field data-invalid={outOfRange || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NumberInput
        id={id}
        value={value}
        min={min}
        max={max}
        step={whole ? 1 : 'any'}
        required
        aria-invalid={outOfRange || undefined}
        onChange={onChange}
      />
      {outOfRange ? (
        <FieldError>
          {max === undefined
            ? t.common.atLeast(min.toLocaleString(locale))
            : (whole ? t.common.wholeBetween : t.common.between)(min.toLocaleString(locale), max.toLocaleString(locale))}
        </FieldError>
      ) : (
        description && <FieldDescription>{description}</FieldDescription>
      )}
    </Field>
  )
}

export function NumberInput({
  value,
  onChange,
  onBlur,
  onFocus,
  ...props
}: Omit<React.ComponentProps<'input'>, 'onChange' | 'type' | 'value'> & {
  value: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setDraft(String(value))
  }, [value])
  return (
    <Input
      {...props}
      type="number"
      inputMode="decimal"
      value={draft}
      onFocus={(event) => {
        editing.current = true
        onFocus?.(event)
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber)
      }}
      onBlur={(event) => {
        editing.current = false
        if (!Number.isFinite(event.target.valueAsNumber)) setDraft(String(value))
        onBlur?.(event)
      }}
    />
  )
}

function settingId(label: string) {
  return `calculator-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`
}
