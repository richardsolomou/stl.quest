import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import type { PublicSmtpConfig } from '../../../core/auth'
import {
  EMAIL_LOGO_TYPES,
  emailTemplateKinds,
  HOSTED_SMTP_PORTS,
  MAX_EMAIL_LOGO_BYTES,
  MAX_EMAIL_SENDER_NAME_LENGTH,
  MAX_EMAIL_TEMPLATE_HTML_LENGTH,
  MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH,
  emailLogoDataUrl,
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

const EMAIL_DESCRIPTION = 'Choose how the invitations and print-ready emails from this workspace look and who they come from.'
const PREVIEW_NAME = 'Maya'
const PLACEHOLDER_HINTS: Record<string, string> = {
  name: 'the requester’s name',
  workspace: 'this workspace’s name',
  prints: 'the list of ready prints',
  link: 'the link back to STL Quest',
  logo: 'your logo, or the workspace name without one',
}
const PREVIEW_PRINTS = [
  { name: 'Bracket', count: 2 },
  { name: 'Cable clip', count: 1 },
]

export function EmailPane({ workspaceName }: { workspaceName: string }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(emailBrandingQuery(workspaceSlug))
  const callSave = useServerFn(saveEmailLogo)
  const queryClient = useQueryClient()
  const hosted = useSuspenseQuery(sessionQuery()).data.hosted
  const input = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: ({ logo }) =>
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, logo }),
  })

  if (!query.data) {
    return (
      <SettingsPage>
        <SettingsHeader title="Email" description={EMAIL_DESCRIPTION} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading email settings…"
          errorTitle="Could not load email settings"
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
    workspaceName,
    logoSrc,
    name: PREVIEW_NAME,
    prints: PREVIEW_PRINTS,
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
      <SettingsHeader title="Email" description={EMAIL_DESCRIPTION} />
      <SettingsSection
        title="Logo"
        description={`Shown at the top of every email instead of the workspace name. PNG, JPEG, or GIF up to ${MAX_EMAIL_LOGO_BYTES / 1024} KB; a wide logo about 96 pixels tall looks sharpest.`}
      >
        <input
          ref={input}
          type="file"
          accept={EMAIL_LOGO_TYPES.join(',')}
          className="sr-only"
          aria-label="Logo image"
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
              alt="Current logo"
              className="h-12 max-w-60 rounded-sm border border-border/70 bg-white object-contain p-1"
            />
          )}
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => input.current?.click()}>
            {mutation.isPending && <Spinner />}
            {logo ? 'Replace logo' : 'Upload logo'}
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
              Remove
            </Button>
          )}
        </div>
        {tooLarge && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: 'That image is too large',
              hint: `Choose a logo of ${MAX_EMAIL_LOGO_BYTES / 1024} KB or less. Exporting it smaller or as a JPEG usually helps.`,
            }}
          />
        )}
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: 'The logo was not changed',
              hint: 'Emails keep using the previous logo. Check the file is a PNG, JPEG, or GIF and try again.',
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
      <SenderSection sender={sender} relayed={relayed} ownServer={smtp.configured} />
      <MailServerSection smtp={smtp} hosted={hosted} />
      <TemplatesSection templates={templates} ownServer={smtp.configured} workspaceName={workspaceName} logoSrc={logoSrc} />
      <SettingsSection
        title="Preview"
        description={[
          'What a requester sees when their prints are ready.',
          from ? `From: ${from}.` : 'From: the server’s default sender.',
          sender.replyTo && `Replies go to ${sender.replyTo}.`,
          `Subject: “${preview.subject}”`,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <iframe
          title="Print-ready email preview"
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
    <SettingsSection title="Sender" description="Leave both empty to keep the server’s default sender.">
      <UnsavedChangesGuard dirty={dirty} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (dirty) mutation.mutate({ data: { workspaceSlug, name: name.trim(), replyTo: replyTo.trim() } })
        }}
      >
        <Field>
          <FieldLabel htmlFor="email-sender-name">Sender name</FieldLabel>
          <Input
            id="email-sender-name"
            value={name}
            maxLength={MAX_EMAIL_SENDER_NAME_LENGTH}
            autoComplete="organization"
            disabled={mutation.isPending}
            onChange={(event) => setName(event.target.value)}
          />
          <FieldDescription>
            {relayed
              ? 'Shown as the sender, followed by “via STL Quest”. The sending address stays STL Quest’s so the email is not marked as spam.'
              : ownServer
                ? 'Shown as the sender, alongside the from address of your mail server.'
                : 'Shown as the sender. The sending address stays the one this server is configured with so the email is not marked as spam.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="email-reply-to">Reply-to address</FieldLabel>
          <Input
            id="email-reply-to"
            type="email"
            value={replyTo}
            autoComplete="email"
            disabled={mutation.isPending}
            onChange={(event) => setReplyTo(event.target.value)}
          />
          <FieldDescription>When someone replies to an email, it goes here.</FieldDescription>
        </Field>
        <div>
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Save
          </Button>
        </div>
      </form>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'The sender was not changed',
            hint: 'Emails keep using the previous sender. Check the reply-to address is a valid email and try again.',
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
  const update = async (next: PublicSmtpConfig) => {
    queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, smtp: next })
    await invalidateQueries(queryClient, 'session')
  }
  return (
    <SettingsSection
      title="Mail server"
      description={
        hosted
          ? 'Optional. Send from your own domain through your mail server instead of STL Quest’s address.'
          : 'Optional. Send this workspace’s email through its own mail server instead of the one this server uses.'
      }
    >
      <SettingRow
        icon={<AuthMethodIcon method="smtp" />}
        name="Your mail server"
        status={{ label: smtp.configured ? 'Sending' : 'Not set up', tone: smtp.configured ? 'on' : 'off' }}
        detail={
          smtp.configured
            ? `Emails are sent from ${smtp.from} through ${smtp.host}.`
            : hosted
              ? 'Emails are sent from STL Quest’s address.'
              : 'Emails use this server’s mail settings.'
        }
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            {smtp.configured ? 'Edit' : 'Connect'}
          </Button>
        }
      />
      {open && (
        <SmtpDialog
          smtp={smtp}
          hint={hosted ? `Use port ${HOSTED_SMTP_PORTS.join(', ')}.` : undefined}
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
  return (
    <SettingsSection
      title="Templates"
      description={
        ownServer
          ? 'Write the subject and HTML yourself. The plain-text version keeps the standard wording.'
          : Object.keys(templates).length
            ? 'Your saved templates are used again once you connect your own mail server.'
            : 'Connect your own mail server to write your own email templates.'
      }
    >
      {ownServer && (
        <>
          <Field>
            <FieldLabel htmlFor="email-template-kind">Email</FieldLabel>
            <Select
              items={emailTemplateKinds.map((option) => ({ value: option.id, label: option.name }))}
              value={kind}
              onValueChange={(value) => setKind(value as EmailTemplateKind)}
            >
              <SelectTrigger id="email-template-kind" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {emailTemplateKinds.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <TemplateEditor key={kind} kind={kind} saved={templates[kind]} workspaceName={workspaceName} logoSrc={logoSrc} />
        </>
      )}
    </SettingsSection>
  )
}

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
  const initial = saved ?? defaultEmailTemplate(kind)
  const [subject, setSubject] = useState(initial.subject)
  const [html, setHtml] = useState(initial.html)
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: ({ templates }) => {
      const next = templates[kind] ?? defaultEmailTemplate(kind)
      setSubject(next.subject)
      setHtml(next.html)
      queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, (current) => current && { ...current, templates })
    },
  })
  const changed = subject.trim() !== initial.subject || html.trim() !== initial.html
  const dirty = changed || !saved
  const template = { subject, html }
  const preview =
    kind === 'invite'
      ? inviteEmail({ workspaceName, logoSrc, url: 'about:blank', template })
      : printReadyEmail({ workspaceName, logoSrc, name: PREVIEW_NAME, prints: PREVIEW_PRINTS, url: 'about:blank', template })
  const placeholders = emailTemplateKinds.find((option) => option.id === kind)!.placeholders
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty) mutation.mutate({ data: { workspaceSlug, kind, template: { subject: subject.trim(), html: html.trim() } } })
      }}
    >
      <UnsavedChangesGuard dirty={changed} />
      <Field>
        <FieldLabel htmlFor="email-template-subject">Subject</FieldLabel>
        <Input
          id="email-template-subject"
          value={subject}
          maxLength={MAX_EMAIL_TEMPLATE_SUBJECT_LENGTH}
          disabled={mutation.isPending}
          onChange={(event) => setSubject(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="email-template-html">HTML</FieldLabel>
        <Textarea
          id="email-template-html"
          value={html}
          maxLength={MAX_EMAIL_TEMPLATE_HTML_LENGTH}
          spellCheck={false}
          disabled={mutation.isPending}
          className="max-h-96 font-mono text-xs [field-sizing:fixed] h-64"
          onChange={(event) => setHtml(event.target.value)}
        />
        <FieldDescription>
          Placeholders:{' '}
          {placeholders.map((key, index) => (
            <span key={key}>
              {index > 0 && ', '}
              <code className="font-mono text-foreground">{`{{${key}}}`}</code> {PLACEHOLDER_HINTS[key]}
            </span>
          ))}
          .
        </FieldDescription>
      </Field>
      <iframe
        title="Template preview"
        sandbox=""
        srcDoc={preview.html}
        className="h-[30rem] w-full rounded-sm border border-border/70 bg-white"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || !subject.trim() || !html.trim() || mutation.isPending}>
          {mutation.isPending && <Spinner />}
          Save template
        </Button>
        {saved && (
          <Button
            type="button"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ data: { workspaceSlug, kind, template: null } })}
          >
            Use the standard email
          </Button>
        )}
      </div>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'The template was not saved',
            hint: 'Emails keep using the previous template. Try again in a moment.',
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
