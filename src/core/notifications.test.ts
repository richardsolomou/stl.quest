import { describe, expect, it } from 'vitest'
import { emailTemplateKinds, emailTemplatePlaceholderCount, MAX_EMAIL_TEMPLATE_PLACEHOLDERS } from './email'
import { defaultEmailTemplate, inviteEmail, notificationPreferences, printReadyEmail, readyPrintsByRequester } from './notifications'

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

  it('links back to the requests in the HTML body', () => {
    const email = printReadyEmail({ workspaceName: 'Lab', prints: [{ name: 'Bracket', count: 1 }], url: 'https://print.example' })
    expect(email.html).toContain('href="https://print.example"')
  })
})

describe('invite email', () => {
  it('names the workspace in the subject', () => {
    expect(inviteEmail({ workspaceName: 'Lab', url: 'https://print.example/invite/t' }).subject).toBe('You are invited to Lab on STL Quest')
  })

  it('includes the single-use link in the plain-text body', () => {
    expect(inviteEmail({ workspaceName: 'Lab', url: 'https://print.example/invite/t' }).text).toContain('https://print.example/invite/t')
  })
})

describe('custom email templates', () => {
  const template = { subject: 'Hi {{name}}', html: '<p>{{prints}} at <a href="{{link}}">{{workspace}}</a></p>' }
  const input = { workspaceName: 'Lab', name: 'Maya', prints: [{ name: 'Bracket', count: 2 }], url: 'https://print.example' }

  it('replaces the subject', () => {
    expect(printReadyEmail({ ...input, template }).subject).toBe('Hi Maya')
  })

  it('fills the HTML body', () => {
    expect(printReadyEmail({ ...input, template }).html).toContain('<a href="https://print.example">Lab</a>')
  })

  it('keeps the standard plain-text part', () => {
    expect(printReadyEmail({ ...input, template }).text).toBe(printReadyEmail(input).text)
  })

  it('replaces the invitation subject', () => {
    const invite = { subject: 'Join {{workspace}}', html: '<a href="{{link}}">Join</a>' }
    expect(inviteEmail({ workspaceName: 'Lab', url: 'https://print.example/invite/t', template: invite }).subject).toBe('Join Lab')
  })

  it('starts from a default that fills every print-ready placeholder', () => {
    expect(printReadyEmail({ ...input, template: defaultEmailTemplate('print-ready') }).html).not.toMatch(/\{\{\w+\}\}/)
  })

  it('greets the requester by name in the default template', () => {
    expect(printReadyEmail({ ...input, template: defaultEmailTemplate('print-ready') }).html).toContain('Hi Maya')
  })

  it.each(emailTemplateKinds.map((kind) => kind.id))('keeps the default %s template within the placeholder limit', (kind) => {
    expect(emailTemplatePlaceholderCount(defaultEmailTemplate(kind))).toBeLessThanOrEqual(MAX_EMAIL_TEMPLATE_PLACEHOLDERS)
  })

  it('starts the invitation from the standard subject', () => {
    expect(defaultEmailTemplate('invite').subject).toBe('You are invited to {{workspace}} on STL Quest')
  })

  it('links the invitation default template to the invite', () => {
    expect(defaultEmailTemplate('invite').html).toContain('href="{{link}}"')
  })

  it('starts from a default that fills every invitation placeholder', () => {
    expect(
      inviteEmail({ workspaceName: 'Lab', url: 'https://print.example/invite/t', template: defaultEmailTemplate('invite') }).html,
    ).not.toMatch(/\{\{\w+\}\}/)
  })

  it('lists the ready prints in the default template', () => {
    expect(printReadyEmail({ ...input, template: defaultEmailTemplate('print-ready') }).html).toContain('<li>Bracket (2 copies)</li>')
  })
})
