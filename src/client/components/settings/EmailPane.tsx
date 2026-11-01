import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { EMAIL_LOGO_TYPES, MAX_EMAIL_LOGO_BYTES, emailLogoDataUrl } from '../../../core/email'
import { printReadyEmail } from '../../../core/notifications'
import { saveEmailLogo } from '../../../server/fns'
import { emailBrandingQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const EMAIL_DESCRIPTION = 'Brand the invitations and print-ready emails people receive from this workspace.'
const PREVIEW_PRINTS = [
  { name: 'Bracket', count: 2 },
  { name: 'Cable clip', count: 1 },
]

export function EmailPane({ workspaceName }: { workspaceName: string }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(emailBrandingQuery(workspaceSlug))
  const callSave = useServerFn(saveEmailLogo)
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: (branding) => queryClient.setQueryData(emailBrandingQuery(workspaceSlug).queryKey, branding),
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

  const { logo } = query.data
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
      <SettingsSection title="Preview" description={`What a requester sees when their prints are ready. Subject: “${preview.subject}”`}>
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
