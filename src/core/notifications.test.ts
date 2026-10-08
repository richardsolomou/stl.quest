import { describe, expect, it } from 'vitest'
import { notificationPreferences, printReadyEmail, readyPrintsByRequester } from './notifications'

describe('notification preferences', () => {
  it('enables print-ready emails by default', () => {
    expect(notificationPreferences([])).toEqual({ 'print-ready': true })
  })

  it('applies a stored opt-out', () => {
    expect(notificationPreferences([{ kind: 'print-ready', enabled: false }])).toEqual({ 'print-ready': false })
  })

  it('ignores stored kinds that no longer exist', () => {
    expect(notificationPreferences([{ kind: 'retired-kind', enabled: false }])).toEqual({ 'print-ready': true })
  })
})

describe('ready prints by requester', () => {
  it('groups copies per requester and request', () => {
    const grouped = readyPrintsByRequester(
      [
        { requestId: 'a', name: 'Bracket', ownerUserId: 'alice', count: 1 },
        { requestId: 'a', name: 'Bracket', ownerUserId: 'alice', count: 2 },
        { requestId: 'b', name: 'Hinge', ownerUserId: 'bob', count: 1 },
      ],
      'admin',
    )
    expect(Object.fromEntries(grouped)).toEqual({ alice: [{ name: 'Bracket', count: 3 }], bob: [{ name: 'Hinge', count: 1 }] })
  })

  it('skips requests owned by whoever moved them', () => {
    expect(readyPrintsByRequester([{ requestId: 'a', name: 'Bracket', ownerUserId: 'admin', count: 1 }], 'admin').size).toBe(0)
  })
})

describe('print ready email', () => {
  it('lists each ready print with its copy count', () => {
    const email = printReadyEmail({ workspaceName: 'Lab', prints: [{ name: 'Bracket', count: 2 }], url: 'https://print.example' })
    expect(email.text).toContain('- Bracket (2 copies)')
  })

  it('uses a singular subject for one copy', () => {
    expect(printReadyEmail({ workspaceName: 'Lab', prints: [{ name: 'Bracket', count: 1 }] }).subject).toBe('Your print is ready in Lab')
  })

  it('escapes request names in the HTML body', () => {
    expect(printReadyEmail({ workspaceName: 'Lab', prints: [{ name: '<b>x</b>', count: 1 }] }).html).not.toContain('<b>x</b>')
  })
})
