import { CalendarIcon, XIcon } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Calendar, dayPickerLocales } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n'

// How far back a purchase date's year menu reaches.
const PAST_YEARS = 30

/** `past` limits it to today and before, with month and year menus, for dates such as when something was bought. */
export function DatePicker({
  id,
  value,
  onChange,
  label,
  past = false,
}: {
  id?: string
  value?: string
  onChange: (value?: string) => void
  label: string
  past?: boolean
}) {
  const { t, locale } = useI18n()
  const selected = value ? parseISO(value) : undefined
  const today = new Date()
  const range = past
    ? {
        captionLayout: 'dropdown' as const,
        required: true,
        startMonth: new Date(today.getFullYear() - PAST_YEARS, 0),
        endMonth: today,
        disabled: { after: today },
        defaultMonth: selected ?? today,
      }
    : {}
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            data-slot="date-picker-trigger"
            className={cn(
              'w-full justify-start bg-transparent font-normal hover:bg-input/50 aria-expanded:bg-input/50',
              !value && 'text-muted-foreground',
            )}
          />
        }
      >
        <CalendarIcon />
        {selected ? format(selected, 'PPP', { locale: dayPickerLocales[locale] }) : label}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          {...range}
          selected={selected}
          onSelect={(date) => onChange(date ? format(date, 'yyyy-MM-dd') : undefined)}
        />
        {value && (
          <div className="border-t p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => onChange(undefined)}>
              <XIcon />
              {t.shell.datePicker.clearDate}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
