import { describe, expect, it } from 'vitest'
import {
  emailLogoDataUrl,
  emailTemplatePlaceholderCount,
  fromHeader,
  fillEmailTemplate,
  hostedSmtpPortAllowed,
  MAX_EMAIL_TEMPLATE_PLACEHOLDERS,
  plainPlaceholder,
  renderEmail,
  senderDisplayName,
} from './email'

const content = {
  workspaceName: 'Lab',
  subject: 'Ready',
  intro: 'Your print is ready.',
  note: 'Turn these off in settings.',
  footer: 'Sent by Lab through STL Quest.',
}

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

describe('from header', () => {
  it('keeps the configured address under a display name', () => {
    expect(fromHeader('Atelier', 'Shop <hello@atelier.example>')).toBe('Atelier <hello@atelier.example>')
  })

  it('wraps a bare configured address under a display name', () => {
    expect(fromHeader('Atelier', 'hello@atelier.example')).toBe('Atelier <hello@atelier.example>')
  })

  it('shows the configured sender without a display name', () => {
    expect(fromHeader(undefined, 'Shop <hello@atelier.example>')).toBe('Shop <hello@atelier.example>')
  })

  it('shows only the display name when the server sender is not known', () => {
    expect(fromHeader('Atelier via STL Quest', undefined)).toBe('Atelier via STL Quest')
  })
})

describe('email templates', () => {
  const placeholders = { name: plainPlaceholder('<Maya>'), prints: { text: 'Bracket', html: '<ul><li>Bracket</li></ul>' } }

  it('escapes plain values in the HTML body', () => {
    expect(fillEmailTemplate({ subject: 's', html: '<p>Hi {{name}}</p>' }, placeholders).html).toBe('<p>Hi &#60;Maya&#62;</p>')
  })

  it('inserts prepared markup for list placeholders', () => {
    expect(fillEmailTemplate({ subject: 's', html: '{{ prints }}' }, placeholders).html).toBe('<ul><li>Bracket</li></ul>')
  })

  it('uses plain values in the subject', () => {
    expect(fillEmailTemplate({ subject: 'Ready, {{name}}', html: '' }, placeholders).subject).toBe('Ready, <Maya>')
  })

  it('keeps the subject on one line', () => {
    expect(fillEmailTemplate({ subject: 'Ready\n{{prints}}', html: '' }, placeholders).subject).toBe('Ready Bracket')
  })

  it('leaves unknown placeholders as written', () => {
    expect(fillEmailTemplate({ subject: '{{unknown}}', html: '' }, placeholders).subject).toBe('{{unknown}}')
  })

  it('stops filling placeholders past the limit', () => {
    const html = '{{prints}}'.repeat(MAX_EMAIL_TEMPLATE_PLACEHOLDERS + 1)
    expect(fillEmailTemplate({ subject: 's', html }, placeholders).html).toBe(
      `${'<ul><li>Bracket</li></ul>'.repeat(MAX_EMAIL_TEMPLATE_PLACEHOLDERS)}{{prints}}`,
    )
  })

  it('counts placeholders in the subject towards the limit', () => {
    const html = '{{name}}'.repeat(MAX_EMAIL_TEMPLATE_PLACEHOLDERS)
    expect(fillEmailTemplate({ subject: '{{name}}', html }, placeholders).html.endsWith('{{name}}')).toBe(true)
  })

  it('counts placeholders in the subject and body', () => {
    expect(emailTemplatePlaceholderCount({ subject: '{{workspace}}', html: '<p>{{ name }} {{link}} {{unknown}}</p>' })).toBe(4)
  })
})
