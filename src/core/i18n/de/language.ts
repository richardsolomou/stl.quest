import type { language as en } from '../en/language'

export const language: typeof en = {
  title: 'Sprache',
  description: 'Wählen Sie, in welcher Sprache STL Quest für Sie angezeigt wird. Andere Personen behalten ihre eigene Wahl.',
  label: 'Sprache der Oberfläche',
  browser: (name) => `Browsersprache (${name})`,
  saveFailedTitle: 'Ihre Sprache wurde nicht geändert',
  saveFailedHint: 'STL Quest verwendet weiterhin Ihre vorherige Wahl. Versuchen Sie es gleich noch einmal.',
}
