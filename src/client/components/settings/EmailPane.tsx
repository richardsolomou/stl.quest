import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import type { PublicSmtpConfig } from '../../../core/auth'
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
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { SmtpDialog } from './SmtpIntegrationSettings'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'
import { useI18n } from '../../i18n'

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
        <SettingsHeader title={copy.title} description={copy.description} />
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
      <SettingsHeader title={copy.title} description={copy.description} />
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
        <div className="flex flex-wrap items-center gap-3">
          {logo && (
            <img
              src={emailLogoDataUrl(logo)}
              alt={copy.logo.current}
              className="h-12 max-w-60 rounded-sm border border-border/70 bg-white object-contain p-1"
            />
          )}
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
        {tooLarge && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: copy.logo.tooLarge,
              hint: copy.logo.tooLargeHint(MAX_EMAIL_LOGO_BYTES / 1024),
            }}
          />
        )}
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: copy.logo.notSaved,
              hint: copy.logo.notSavedHint,
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
      <SenderSection sender={sender} relayed={relayed} ownServer={smtp.configured} />
      <MailServerSection smtp={smtp} hosted={hosted} />
      <TemplatesSection templates={templates} ownServer={smtp.configured} workspaceName={workspaceName} logoSrc={logoSrc} />
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
  const [name, setName] = useState(sender.name ?? '')
  const [replyTo, setReplyTo] = useState(sender.replyTo ?? '')
  const { t } = useI18n()
  const copy = t.settings.email.sender
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: (saved) => {
      setName(saved.sender.name ?? '')
      setReplyTo(saved.sender.replyTo ?? '')
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, sender: saved.sender })
    },
  })
  const dirty = name.trim() !== (sender.name ?? '') || replyTo.trim() !== (sender.replyTo ?? '')
  return (
    <SettingsSection title={copy.title} description={copy.description}>
      <UnsavedChangesGuard dirty={dirty} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (dirty) mutation.mutate({ data: { workspaceSlug, name: name.trim(), replyTo: replyTo.trim() } })
        }}
      >
        <Field>
          <FieldLabel htmlFor="email-sender-name">{copy.nameLabel}</FieldLabel>
          <Input
            id="email-sender-name"
            value={name}
            maxLength={MAX_EMAIL_SENDER_NAME_LENGTH}
            autoComplete="organization"
            disabled={mutation.isPending}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription>{relayed ? copy.nameRelayed : ownServer ? copy.nameOwnServer : copy.nameDefault}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="email-reply-to">{copy.replyToLabel}</FieldLabel>
          <Input
            id="email-reply-to"
            type="email"
            value={replyTo}
            autoComplete="email"
            disabled={mutation.isPending}
            onChange={(event) => setReplyTo(event.target.value)}
          />
          <FieldDescription>{copy.replyToHint}</FieldDescription>
        </Field>
        <div>
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            {t.common.save}
          </Button>
        </div>
      </form>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: copy.notSaved,
            hint: copy.notSavedHint,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}

function MailServerSection({ smtp, hosted }: { smtp: PublicSmtpConfig; hosted: boolean }) {
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

function TemplatesSection({
  templates,
  ownServer,
  workspaceName,
  logoSrc,
}: {
  templates: EmailTemplates
  ownServer: boolean
  workspaceName: string
  logoSrc?: string
}) {
  const [kind, setKind] = useState<EmailTemplateKind>('print-ready')
  // Drafts outlive switching between emails, so comparing two templates never discards an edit.
  const [drafts, setDrafts] = useState<EmailTemplates>({})
  const { t } = useI18n()
  const copy = t.settings.email.templates
  const startingPoint = (option: EmailTemplateKind) => templates[option] ?? defaultEmailTemplate(option, t.email)
  const changed = (option: EmailTemplateKind) => {
    const draft = drafts[option]
    const start = startingPoint(option)
    return draft !== undefined && (draft.subject.trim() !== start.subject || draft.html.trim() !== start.html)
  }
  return (
    <SettingsSection
      title={copy.title}
      description={ownServer ? copy.descriptionOwnServer : Object.keys(templates).length ? copy.descriptionSaved : copy.descriptionNone}
    >
      {ownServer && (
        <>
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
          <UnsavedChangesGuard dirty={emailTemplateKinds.some((option) => changed(option.id))} />
          <TemplateEditor
            key={kind}
            kind={kind}
            saved={templates[kind]}
            draft={drafts[kind] ?? startingPoint(kind)}
            changed={changed(kind)}
            onChange={(draft) => setDrafts((current) => ({ ...current, [kind]: draft }))}
            onSaved={(saved, template) => setDrafts((current) => ({ ...current, [saved]: template }))}
            workspaceName={workspaceName}
            logoSrc={logoSrc}
          />
        </>
      )}
    </SettingsSection>
  )
}

function TemplateEditor({
  kind,
  saved,
  draft,
  changed,
  onChange,
  onSaved,
  workspaceName,
  logoSrc,
}: {
  kind: EmailTemplateKind
  saved?: EmailTemplate
  draft: EmailTemplate
  changed: boolean
  onChange: (draft: EmailTemplate) => void
  onSaved: (kind: EmailTemplateKind, template?: EmailTemplate) => void
  workspaceName: string
  logoSrc?: string
}) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callSave = useServerFn(saveEmailTemplate)
  const { t } = useI18n()
  const copy = t.settings.email.templates
  const sample = t.settings.email.sample
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: ({ templates }, { data }) => {
      onSaved(data.kind, templates[data.kind])
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, templates })
    },
  })
  const { subject, html } = draft
  const dirty = changed || !saved
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
  const placeholderCount = emailTemplatePlaceholderCount(draft)
  const tooManyPlaceholders = placeholderCount > MAX_EMAIL_TEMPLATE_PLACEHOLDERS
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty) mutation.mutate({ data: { workspaceSlug, kind, template: { subject: subject.trim(), html: html.trim() } } })
      }}
    >
      <Field>
        <FieldLabel htmlFor="email-template-subject">{copy.subjectLabel}</FieldLabel>
        <Input
          id="email-template-subject"
          value={subject}
          maxLength={MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH}
          disabled={mutation.isPending}
          onChange={(event) => onChange({ ...draft, subject: event.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="email-template-html">{copy.htmlLabel}</FieldLabel>
        <Textarea
          id="email-template-html"
          value={html}
          maxLength={MAX_EMAIL_TEMPLATE_HTML_LENGTH}
          spellCheck={false}
          disabled={mutation.isPending}
          aria-invalid={tooManyPlaceholders || undefined}
          className="max-h-96 font-mono text-xs [field-sizing:fixed] h-64"
          onChange={(event) => onChange({ ...draft, html: event.target.value })}
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || !subject.trim() || !html.trim() || tooManyPlaceholders || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          {copy.save}
        </Button>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ data: { workspaceSlug, kind, template: null } })}
          >
            {copy.useStandard}
          </Button>
        )}
      </div>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: copy.notSaved,
            hint: copy.notSavedHint,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </form>
  )
}

function base64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
