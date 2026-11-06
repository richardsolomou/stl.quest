import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { setThemePreference, themePreferences, useThemePreference, type ThemePreference } from '../../theme'
import { SettingsSection } from './SettingsLayout'

export function AccountAppearance() {
  const preference = useThemePreference()
  return (
    <SettingsSection title="Appearance">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="theme-preference">Theme</FieldLabel>
          <FieldDescription>Saved in this browser, so each device can keep its own.</FieldDescription>
        </FieldContent>
        <Select items={themePreferences} value={preference} onValueChange={(value) => setThemePreference(value as ThemePreference)}>
          <SelectTrigger id="theme-preference" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {themePreferences.map((option) => (
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
