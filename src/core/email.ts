export const EMAIL_LOGO_SETTING = 'email-logo'
export const EMAIL_LOGO_CID = 'workspace-logo'
export const EMAIL_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const
export const MAX_EMAIL_LOGO_BYTES = 256 * 1024
export const EMAIL_SENDER_SETTING = 'email-sender'
export const MAX_EMAIL_SENDER_NAME_LENGTH = 64
export const WORKSPACE_SMTP_SETTING = 'emailSmtpEncrypted'
/** Submission ports a hosted workspace's own mail server may use; anything else is not a mail submission service. */
export const HOSTED_SMTP_PORTS = [465, 587, 2525] as const

export type EmailLogoType = (typeof EMAIL_LOGO_TYPES)[number]
/** Stored as base64 so the logo travels inside the settings JSON and the email itself. */
export type EmailLogo = { contentType: EmailLogoType; data: string }
export type EmailSender = { name?: string; replyTo?: string }
export type EmailBranding = { logo?: EmailLogo; sender?: EmailSender }

export type EmailContent = {
  workspaceName: string
  /** `cid:` when sending, a data URL in the settings preview. */
  logoSrc?: string
  subject: string
  intro: string
  items?: string[]
  action?: { label: string; url: string }
  note: string
}

export function isEmailLogoType(value: string): value is EmailLogoType {
  return EMAIL_LOGO_TYPES.includes(value as EmailLogoType)
}

export function emailLogoDataUrl(logo: EmailLogo) {
  return `data:${logo.contentType};base64,${logo.data}`
}

/** Mail relayed through the hosted service's shared address names the relay, so a workspace cannot pose as another sender. */
export function senderDisplayName(name: string | undefined, relayed: boolean) {
  if (!name) return undefined
  return relayed ? `${name} via STL Quest` : name
}

/** How the From header reads: a display name replaces the one in the configured sender but keeps its address. */
export function fromHeader(displayName: string | undefined, configuredFrom: string | undefined) {
  if (!displayName || !configuredFrom) return displayName ?? configuredFrom
  return `${displayName} <${/<([^<>]+)>\s*$/.exec(configuredFrom)?.[1] ?? configuredFrom}>`
}

export function hostedSmtpPortAllowed(port: number) {
  return HOSTED_SMTP_PORTS.includes(port as (typeof HOSTED_SMTP_PORTS)[number])
}

export function renderEmail(content: EmailContent) {
  return { subject: content.subject, text: emailText(content), html: emailHtml(content) }
}

function emailText(content: EmailContent) {
  return [
    content.intro,
    ...(content.items?.length ? ['', ...content.items.map((item) => `- ${item}`)] : []),
    ...(content.action ? ['', `${content.action.label}: ${content.action.url}`] : []),
    '',
    content.note,
    '',
    `Sent by ${content.workspaceName} through STL Quest.`,
  ].join('\n')
}

const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

function emailHtml(content: EmailContent) {
  const name = escapeHtml(content.workspaceName)
  const brand = content.logoSrc
    ? `<img src="${escapeHtml(content.logoSrc)}" alt="${name}" style="display:block;width:auto;height:auto;max-width:100%;max-height:48px;border:0">`
    : `<span style="${font};font-size:20px;font-weight:600;color:#15171c">${name}</span>`
  const items = content.items?.length
    ? `<ul style="margin:0 0 20px;padding:0 0 0 20px;${font};font-size:15px;line-height:24px;color:#15171c">${content.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : ''
  const action = content.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="border-radius:6px;background:#e89a3c"><a href="${escapeHtml(content.action.url)}" style="display:inline-block;padding:12px 20px;${font};font-size:15px;font-weight:600;color:#15171c;text-decoration:none">${escapeHtml(content.action.label)}</a></td></tr></table>`
    : ''
  return [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head>`,
    '<body style="margin:0;padding:0;background:#f3f1ec">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec"><tr><td align="center" style="padding:32px 16px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2ded3;border-radius:8px">',
    `<tr><td style="padding:24px 32px;border-bottom:2px solid #4fa8b8">${brand}</td></tr>`,
    '<tr><td style="padding:28px 32px 12px">',
    `<p style="margin:0 0 20px;${font};font-size:15px;line-height:24px;color:#15171c">${escapeHtml(content.intro)}</p>`,
    items,
    action,
    `<p style="margin:0 0 16px;${font};font-size:13px;line-height:20px;color:#5f645c">${escapeHtml(content.note)}</p>`,
    '</td></tr></table>',
    `<p style="margin:16px 0 0;${font};font-size:12px;line-height:18px;color:#8a8e86">Sent by ${name} through STL Quest.</p>`,
    '</td></tr></table></body></html>',
  ].join('')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
}
