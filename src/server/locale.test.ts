import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE } from '../core/i18n'
import { requestLocale, setRequestLocale, withRequestLocale } from './locale'

describe('request locale', () => {
  it('keeps concurrent request languages isolated across asynchronous work', async () => {
    const run = (locale: string) =>
      withRequestLocale(new Request('http://localhost/', { headers: { 'accept-language': locale } }), async () => {
        await Promise.resolve()
        return requestLocale()
      })
    expect(await Promise.all([run('de'), run('fr')])).toEqual(['de', 'fr'])
    expect(requestLocale()).toBe(DEFAULT_LOCALE)
  })

  it('uses the signed-in language only inside the current request', () => {
    withRequestLocale(undefined, () => {
      expect(requestLocale()).toBe(DEFAULT_LOCALE)
      setRequestLocale('de')
      expect(requestLocale()).toBe('de')
    })
    expect(requestLocale()).toBe(DEFAULT_LOCALE)
  })
})
