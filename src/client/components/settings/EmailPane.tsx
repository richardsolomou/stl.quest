import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  EMAIL_LOGO_TYPES,
  MAX_EMAIL_LOGO_BYTES,
  MAX_EMAIL_SENDER_NAME_LENGTH,
  emailLogoDataUrl,
  senderDisplayName,
  type EmailSender,
} from '../../../core/email'
import { printReadyEmail } from '../../../core/notifications'
import { saveEmailLogo, saveEmailSender } from '../../../server/fns'
import { emailBrandingQuery, sessionQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const EMAIL_DESCRIPTION = 'Choose how the invitations and print-ready emails from this workspace look and who they come from.'
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

  const { logo, sender } = query.data
  const fromName = senderDisplayName(sender.name, hosted)
  const preview = printReadyEmail({
    workspaceName,
    logoSrc: logo ? emailLogoDataUrl(logo) : undefined,
    prints: PREVIEW_PRINTS,
    url: 'about:blank',
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
      <SenderSection sender={sender} hosted={hosted} />
      <SettingsSection
        title="Preview"
        description={[
          'What a requester sees when their prints are ready.',
          fromName ? `From: ${fromName}.` : 'From: the server’s default sender.',
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

function SenderSection({ sender, hosted }: { sender: EmailSender; hosted: boolean }) {
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
            {hosted
              ? 'Shown as the sender, followed by “via STL Quest”. The sending address stays STL Quest’s so the email is not marked as spam.'
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
