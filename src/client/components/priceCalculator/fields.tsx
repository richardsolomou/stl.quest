import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export type SetupMode = 'preset' | 'custom'

export function SetupGroup({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-border/70 bg-muted/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="font-heading text-sm font-semibold tracking-tight">{title}</h3>
          {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ModeSelector({ label, value, onChange }: { label: string; value: SetupMode; onChange: (value: SetupMode) => void }) {
  return (
    <fieldset className="m-0 flex min-w-0 rounded-lg border border-input bg-background p-0.5">
      <legend className="sr-only">{label} mode</legend>
      {(['preset', 'custom'] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="xs"
          variant={value === option ? 'secondary' : 'ghost'}
          className="capitalize"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </Button>
      ))}
    </fieldset>
  )
}

export function NumberSetting({
  label,
  value,
  min,
  max,
  description,
  onChange,
}: {
  label: string
  value: number
  min: number
  max?: number
  description?: ReactNode
  onChange: (value: number) => void
}) {
  const id = settingId(label)
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NumberInput id={id} value={value} min={min} max={max} step="any" required onChange={onChange} />
      {description && <FieldDescription>{description}</FieldDescription>}
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
