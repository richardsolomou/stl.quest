import { describe, expect, it } from 'vitest'
import { emailLogoDataUrl, hostedSmtpPortAllowed, renderEmail, senderDisplayName } from './email'

const content = { workspaceName: 'Lab', subject: 'Ready', intro: 'Your print is ready.', note: 'Turn these off in settings.' }

describe('email layout', () => {
  it('shows the workspace name when there is no logo', () => {
    expect(renderEmail(content).html).toContain('>Lab</span>')
  })

  it('shows the logo with the workspace name as its alternative text', () => {
    expect(renderEmail({ ...content, logoSrc: 'cid:workspace-logo' }).html).toContain('<img src="cid:workspace-logo" alt="Lab"')
  })

  it('escapes the workspace name', () => {
    expect(renderEmail({ ...content, workspaceName: '<b>Lab</b>' }).html).not.toContain('<b>Lab</b>')
  })

  it('renders the action as a link', () => {
    expect(renderEmail({ ...content, action: { label: 'Open', url: 'https://print.example/?a=1&b=2' } }).html).toContain(
      'href="https://print.example/?a=1&#38;b=2"',
    )
  })

  it('spells out the action link in the plain-text body', () => {
    expect(renderEmail({ ...content, action: { label: 'Open', url: 'https://print.example' } }).text).toContain(
      'Open: https://print.example',
    )
  })

  it('credits the workspace in the plain-text footer', () => {
    expect(renderEmail(content).text).toContain('Sent by Lab through STL Quest.')
  })
})

describe('email logo', () => {
  it('builds a data URL for the settings preview', () => {
    expect(emailLogoDataUrl({ contentType: 'image/png', data: 'AAAA' })).toBe('data:image/png;base64,AAAA')
  })
})

describe('sender display name', () => {
  it('uses the name as entered when the mail is not relayed', () => {
    expect(senderDisplayName('Atelier', false)).toBe('Atelier')
  })

  it('names STL Quest when the mail is relayed', () => {
    expect(senderDisplayName('Atelier', true)).toBe('Atelier via STL Quest')
  })

  it('leaves the server sender alone without a name', () => {
    expect(senderDisplayName(undefined, true)).toBeUndefined()
  })
})

describe('hosted mail server ports', () => {
  it.each([465, 587, 2525])('allows submission port %i', (port) => {
    expect(hostedSmtpPortAllowed(port)).toBe(true)
  })

  it.each([25, 22, 6379])('refuses port %i', (port) => {
    expect(hostedSmtpPortAllowed(port)).toBe(false)
  })
})
