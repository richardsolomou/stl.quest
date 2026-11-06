import type { language as en } from '../en/language'

export const language: typeof en = {
  title: 'Langue',
  description: 'Choisissez la langue dans laquelle STL Quest s’affiche pour vous. Les autres personnes gardent leur propre choix.',
  label: 'Langue de l’interface',
  browser: (name) => `Langue du navigateur (${name})`,
  saveFailedTitle: 'Votre langue n’a pas été modifiée',
  saveFailedHint: 'STL Quest utilise toujours votre choix précédent. Réessayez dans un instant.',
}
