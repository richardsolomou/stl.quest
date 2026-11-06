import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { setThemePreference, themePreferences, useThemePreference, type ThemePreference } from '../../theme'
import { useI18n } from '../../i18n'
import { SettingsSection } from './SettingsLayout'

export function AccountAppearance() {
  const preference = useThemePreference()
  const copy = useI18n().t.account.appearance
  const items = themePreferences.map((value) => ({ value, label: copy.themes[value] }))
  return (
    <SettingsSection title={copy.title}>
      <Field orientation="horizontal" className="max-sm:flex-col">
        <FieldContent>
          <FieldLabel htmlFor="theme-preference">{copy.theme}</FieldLabel>
          <FieldDescription>{copy.themeDescription}</FieldDescription>
        </FieldContent>
        <Select items={items} value={preference} onValueChange={(value) => setThemePreference(value as ThemePreference)}>
          <SelectTrigger id="theme-preference" className="w-40 max-sm:w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {items.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </SettingsSection>
  )
}
