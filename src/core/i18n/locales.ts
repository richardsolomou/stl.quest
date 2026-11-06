export const LOCALES = ['en', 'fr', 'de'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

/** Each language is named in itself so a reader can find theirs whatever the interface currently shows. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français', de: 'Deutsch' }

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** The first supported language in an `Accept-Language` header, by quality and then order; regional tags match their base language. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...parameters] = part.split(';').map((piece) => piece.trim())
      const quality = parameters.find((parameter) => parameter.startsWith('q='))
      return { tag: tag.toLowerCase(), quality: quality === undefined ? 1 : Number(quality.slice(2)), index }
    })
    .filter(({ tag, quality }) => tag && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/** A stored preference wins; otherwise the browser's languages decide. */
export function resolveLocale(preference: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  return isLocale(preference) ? preference : negotiateLocale(acceptLanguage)
}
