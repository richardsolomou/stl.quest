import { describe, expect, it } from 'vitest'
import { emailLogoDataUrl, renderEmail } from './email'

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
