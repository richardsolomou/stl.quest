import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import type { PublicSmtpConfig } from '../../../core/auth'
import { base64 } from '../../base64'
import type { Messages } from '../../../core/i18n'
import {
  EMAIL_LOGO_TYPES,
  emailTemplateKinds,
  HOSTED_SMTP_PORTS,
  MAX_EMAIL_LOGO_BYTES,
  MAX_EMAIL_SENDER_NAME_LENGTH,
  MAX_EMAIL_TEMPLATE_HTML_LENGTH,
  MAX_EMAIL_TEMPLATE_PLACEHOLDERS,
  MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH,
  emailLogoDataUrl,
  emailTemplatePlaceholderCount,
  plausibleReplyTo,
  validSenderName,
  fromHeader,
  senderDisplayName,
  type EmailSender,
  type EmailTemplate,
  type EmailTemplateKind,
  type EmailTemplates,
} from '../../../core/email'
import { defaultEmailTemplate, inviteEmail, printReadyEmail } from '../../../core/notifications'
import { removeWorkspaceSmtp, saveEmailLogo, saveEmailSender, saveEmailTemplate, saveWorkspaceSmtp } from '../../../server/fns'
import { emailBrandingQuery, sessionQuery } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { AuthMethodIcon } from '../AuthMethodIcon'
import { SettingRow } from '../SettingRow'
import { useWorkspaceSlug } from '../../workspace'
import { QueryState } from '../QueryState'
import { SettingNotice, errorNotice } from '../SettingNotice'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SmtpDialog } from './SmtpIntegrationSettings'
import { useI18n } from '../../i18n'
import { useAutosave, useAutosavedDraft } from '../../useAutosave'

const previewPrints = (sample: Messages['settings']['email']['sample']) => [
  { name: sample.firstPrint, count: 2 },
  { name: sample.secondPrint, count: 1 },
]

export function EmailPane({ workspaceName }: { workspaceName: string }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(emailBrandingQuery(workspaceSlug))
  const callSave = useServerFn(saveEmailLogo)
  const queryClient = useQueryClient()
  const hosted = useSuspenseQuery(sessionQuery()).data.hosted
  const input = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const { t } = useI18n()
  const copy = t.settings.email
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: ({ logo }) =>
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, logo }),
  })

  if (!query.data) {
    return (
      <SettingsPage>
        <PageHeader title={copy.title} description={copy.description} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={copy.loading}
          errorTitle={copy.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  const { logo, sender, smtp, templates } = query.data
  const relayed = hosted && !smtp.configured
  const from = fromHeader(senderDisplayName(sender.name, relayed), smtp.configured ? smtp.from : undefined)
  const logoSrc = logo ? emailLogoDataUrl(logo) : undefined
  const preview = printReadyEmail({
    t: t.email,
    workspaceName,
    logoSrc,
    name: copy.sample.name,
    prints: previewPrints(copy.sample),
    url: 'about:blank',
    template: smtp.configured ? templates['print-ready'] : undefined,
  })
  const choose = async (file: File) => {
    mutation.reset()
    setTooLarge(file.size > MAX_EMAIL_LOGO_BYTES)
    if (file.size > MAX_EMAIL_LOGO_BYTES) return
    mutation.mutate({ data: { workspaceSlug, data: await base64(file) } })
  }

  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      <SettingsSection title={copy.logo.title} description={copy.logo.description(MAX_EMAIL_LOGO_BYTES / 1024)}>
        <input
          ref={input}
          type="file"
          accept={EMAIL_LOGO_TYPES.join(',')}
          className="sr-only"
          aria-label={copy.logo.input}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void choose(file)
          }}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          {/* Email paper stays white in both themes, and without a logo the header shows the name as `brandHtml` sets it. */}
          <div className="grid h-20 w-full max-w-72 place-items-center overflow-hidden rounded-sm border border-border/70 bg-white px-4">
            {logoSrc ? (
              <img src={logoSrc} alt={copy.logo.current} className="max-h-12 max-w-full object-contain" />
            ) : (
              <span className="ph-no-capture truncate font-sans text-xl font-semibold text-[#15171c]">{workspaceName}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-3">
            <p className="text-sm text-muted-foreground">{logo ? copy.logo.shown : copy.logo.fallback}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => input.current?.click()}>
                {mutation.isPending && <Spinner />}
                {logo ? copy.logo.replace : copy.logo.upload}
              </Button>
              {logo && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setTooLarge(false)
                    mutation.mutate({ data: { workspaceSlug, data: null } })
                  }}
                >
                  {t.common.remove}
                </Button>
              )}
            </div>
          </div>
        </div>
        {tooLarge && <SettingNotice notice={errorNotice(copy.logo.tooLarge, copy.logo.tooLargeHint(MAX_EMAIL_LOGO_BYTES / 1024))} />}
        {mutation.error && <SettingNotice notice={errorNotice(copy.logo.notSaved, copy.logo.notSavedHint, mutation.error)} />}
      </SettingsSection>
      <SenderSection sender={sender} relayed={relayed} ownServer={smtp.configured} />
      <MailServerSection smtp={smtp} hosted={hosted} templatesSaved={Object.keys(templates).length > 0} />
      {smtp.configured && <TemplatesSection templates={templates} workspaceName={workspaceName} logoSrc={logoSrc} />}
      <SettingsSection
        title={copy.preview.title}
        description={[
          copy.preview.intro,
          from ? copy.preview.from(from) : copy.preview.defaultFrom,
          sender.replyTo && copy.preview.replyTo(sender.replyTo),
          copy.preview.subject(preview.subject),
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <iframe
          title={copy.preview.frameTitle}
          sandbox=""
          srcDoc={preview.html}
          className="h-[30rem] w-full rounded-sm border border-border/70 bg-white"
        />
      </SettingsSection>
    </SettingsPage>
  )
}

function SenderSection({ sender, relayed, ownServer }: { sender: EmailSender; relayed: boolean; ownServer: boolean }) {
  const workspaceSlug = useWorkspaceSlug()
  const callSave = useServerFn(saveEmailSender)
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.email.sender
  const stored = useMemo(() => ({ name: sender.name ?? '', replyTo: sender.replyTo ?? '' }), [sender.name, sender.replyTo])
  const { draft, setDraft, bind } = useAutosavedDraft(stored, {
    valid: (value) => validSenderName(value.name) && plausibleReplyTo(value.replyTo),
    save: async (value) => {
      const saved = await callSave({ data: { workspaceSlug, name: value.name.trim(), replyTo: value.replyTo.trim() } })
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, sender: saved.sender })
    },
  })
  // Checked once the field is left, so an address is not called invalid while it is still being typed.
  const [leftReplyTo, setLeftReplyTo] = useState(false)
  const replyToInvalid = leftReplyTo && !plausibleReplyTo(draft.replyTo)
  return (
    <SettingsSection {...bind} title={copy.title} description={copy.description}>
      <Field>
        <FieldLabel htmlFor="email-sender-name">{copy.nameLabel}</FieldLabel>
        <Input
          id="email-sender-name"
          value={draft.name}
          maxLength={MAX_EMAIL_SENDER_NAME_LENGTH}
          autoComplete="organization"
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        <FieldDescription>{relayed ? copy.nameRelayed : ownServer ? copy.nameOwnServer : copy.nameDefault}</FieldDescription>
      </Field>
      <Field data-invalid={replyToInvalid || undefined}>
        <FieldLabel htmlFor="email-reply-to">{copy.replyToLabel}</FieldLabel>
        <Input
          id="email-reply-to"
          type="email"
          value={draft.replyTo}
          autoComplete="email"
          aria-invalid={replyToInvalid || undefined}
          onFocus={() => setLeftReplyTo(false)}
          onBlur={() => setLeftReplyTo(true)}
          onChange={(event) => setDraft((current) => ({ ...current, replyTo: event.target.value }))}
        />
        {replyToInvalid ? <FieldError>{copy.replyToInvalid}</FieldError> : <FieldDescription>{copy.replyToHint}</FieldDescription>}
      </Field>
    </SettingsSection>
  )
}

function MailServerSection({ smtp, hosted, templatesSaved }: { smtp: PublicSmtpConfig; hosted: boolean; templatesSaved: boolean }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callSave = useServerFn(saveWorkspaceSmtp)
  const callRemove = useServerFn(removeWorkspaceSmtp)
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const copy = t.settings.email.server
  const update = async (next: PublicSmtpConfig) => {
    queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, smtp: next })
    await invalidateQueries(queryClient, 'session')
  }
  return (
    <SettingsSection title={copy.title} description={hosted ? copy.descriptionHosted : copy.description}>
      <SettingRow
        icon={<AuthMethodIcon method="smtp" />}
        name={copy.name}
        status={{ label: smtp.configured ? copy.sending : copy.notSetUp, tone: smtp.configured ? 'on' : 'off' }}
        detail={smtp.configured ? copy.sentThrough(smtp.from, smtp.host) : hosted ? copy.sentFromHosted : copy.sentFromServer}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            {smtp.configured ? t.common.edit : copy.connect}
          </Button>
        }
      />
      {!smtp.configured && (
        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          {templatesSaved ? t.settings.email.templates.descriptionSaved : t.settings.email.templates.descriptionNone}
        </p>
      )}
      {open && (
        <SmtpDialog
          smtp={smtp}
          hint={hosted ? copy.hostedPortHint(HOSTED_SMTP_PORTS.join(', ')) : undefined}
          save={async (values) => update(await callSave({ data: { workspaceSlug, ...values } }))}
          remove={async () => update(await callRemove({ data: { workspaceSlug } }))}
          onDone={() => setOpen(false)}
        />
      )}
    </SettingsSection>
  )
}

function TemplatesSection({ templates, workspaceName, logoSrc }: { templates: EmailTemplates; workspaceName: string; logoSrc?: string }) {
  const [kind, setKind] = useState<EmailTemplateKind>('print-ready')
  const { t } = useI18n()
  const copy = t.settings.email.templates
  return (
    <SettingsSection title={copy.title} description={copy.descriptionOwnServer}>
      <Field>
        <FieldLabel htmlFor="email-template-kind">{copy.kindLabel}</FieldLabel>
        <Select
          items={emailTemplateKinds.map((option) => ({ value: option.id, label: copy.kinds[option.id] }))}
          value={kind}
          onValueChange={(value) => setKind(value as EmailTemplateKind)}
        >
          <SelectTrigger id="email-template-kind" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {emailTemplateKinds.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {copy.kinds[option.id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <TemplateEditor key={kind} kind={kind} saved={templates[kind]} workspaceName={workspaceName} logoSrc={logoSrc} />
    </SettingsSection>
  )
}

/**
 * One email's subject and HTML, saved as they are edited; the standard email is stored as no template, so going back to
 * it and editing it back to the standard text are the same.
 */
function TemplateEditor({
  kind,
  saved,
  workspaceName,
  logoSrc,
}: {
  kind: EmailTemplateKind
  saved?: EmailTemplate
  workspaceName: string
  logoSrc?: string
}) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callSave = useServerFn(saveEmailTemplate)
  const { t } = useI18n()
  const copy = t.settings.email.templates
  const sample = t.settings.email.sample
  const standard = defaultEmailTemplate(kind, t.email)
  const [draft, setDraft] = useState(saved ?? standard)
  const { subject, html } = draft
  const placeholderCount = emailTemplatePlaceholderCount(draft)
  const tooManyPlaceholders = placeholderCount > MAX_EMAIL_TEMPLATE_PLACEHOLDERS
  const trimmed = { subject: subject.trim(), html: html.trim() }
  const isStandard = trimmed.subject === standard.subject && trimmed.html === standard.html
  const autosave = useAutosave({
    value: trimmed,
    initial: saved ?? standard,
    valid: Boolean(trimmed.subject && trimmed.html) && !tooManyPlaceholders,
    save: async (template) => {
      const standardText = template.subject === standard.subject && template.html === standard.html
      const { templates } = await callSave({ data: { workspaceSlug, kind, template: standardText ? null : template } })
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, templates })
    },
  })
  const template = draft
  const preview =
    kind === 'invite'
      ? inviteEmail({ t: t.email, workspaceName, logoSrc, url: 'about:blank', template })
      : printReadyEmail({
          t: t.email,
          workspaceName,
          logoSrc,
          name: sample.name,
          prints: previewPrints(sample),
          url: 'about:blank',
          template,
        })
  const placeholders = emailTemplateKinds.find((option) => option.id === kind)!.placeholders
  return (
    <div className="flex flex-col gap-4" onBlur={() => void autosave.flush()}>
      <Field>
        <FieldLabel htmlFor="email-template-subject">{copy.subjectLabel}</FieldLabel>
        <Input
          id="email-template-subject"
          value={subject}
          maxLength={MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH}
          aria-invalid={!trimmed.subject || undefined}
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
        />
        {!trimmed.subject && <FieldError>{copy.subjectRequired}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor="email-template-html">{copy.htmlLabel}</FieldLabel>
        <Textarea
          id="email-template-html"
          value={html}
          maxLength={MAX_EMAIL_TEMPLATE_HTML_LENGTH}
          spellCheck={false}
          aria-invalid={tooManyPlaceholders || !trimmed.html || undefined}
          className="max-h-96 font-mono text-xs [field-sizing:fixed] h-64"
          onChange={(event) => setDraft({ ...draft, html: event.target.value })}
        />
        <FieldDescription>
          {copy.placeholders}
          {placeholders.map((key, index) => (
            <span key={key}>
              {index > 0 && ', '}
              <code className="font-mono text-foreground">{`{{${key}}}`}</code> {copy.placeholderDescriptions[key]}
            </span>
          ))}
          .
        </FieldDescription>
        {tooManyPlaceholders && <FieldError>{copy.tooManyPlaceholders(MAX_EMAIL_TEMPLATE_PLACEHOLDERS, placeholderCount)}</FieldError>}
        {!trimmed.html && <FieldError>{copy.htmlRequired}</FieldError>}
      </Field>
      <Field>
        <iframe
          title={copy.previewTitle}
          sandbox=""
          srcDoc={preview.html}
          className="h-[30rem] w-full rounded-sm border border-border/70 bg-white"
        />
        <FieldDescription>{copy.previewHint}</FieldDescription>
      </Field>
      {!isStandard && (
        <div>
          <Button type="button" variant="ghost" onClick={() => setDraft(standard)}>
            {copy.useStandard}
          </Button>
        </div>
      )}
    </div>
  )
}
