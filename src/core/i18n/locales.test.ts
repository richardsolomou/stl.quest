import { describe, expect, it } from 'vitest'
import { messagesFor, negotiateLocale, resolveLocale, statusText } from '.'

describe('negotiateLocale', () => {
  it('matches a regional tag to its base language', () => {
    expect(negotiateLocale('fr-CA,fr;q=0.9')).toBe('fr')
  })

  it('matches Austrian German to German', () => {
    expect(negotiateLocale('de-AT,de;q=0.9,en;q=0.8')).toBe('de')
  })

  it('prefers the highest quality supported language', () => {
    expect(negotiateLocale('es;q=1,en;q=0.5,fr;q=0.8')).toBe('fr')
  })

  it('keeps header order between equal qualities', () => {
    expect(negotiateLocale('en-GB,fr')).toBe('en')
  })

  it('ignores languages the browser rejects', () => {
    expect(negotiateLocale('fr;q=0,es')).toBe('en')
  })

  it('falls back to English without a header', () => {
    expect(negotiateLocale(undefined)).toBe('en')
  })
})

describe('resolveLocale', () => {
  it('uses a stored preference over the browser', () => {
    expect(resolveLocale('en', 'fr-FR')).toBe('en')
  })

  it('ignores an unsupported stored preference', () => {
    expect(resolveLocale('xx', 'fr-FR')).toBe('fr')
  })
})

describe('statusText', () => {
  it('translates a workflow status', () => {
    expect(statusText(messagesFor('fr'), 'label', 'done')).toBe('Prêt')
  })

  it('translates a workflow status into German', () => {
    expect(statusText(messagesFor('de'), 'label', 'todo')).toBe('Warteschlange')
  })

  it('falls back to the id for an unknown status', () => {
    expect(statusText(messagesFor('fr'), 'label', 'custom')).toBe('custom')
  })
})
