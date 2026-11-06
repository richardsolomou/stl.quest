import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { createInvite, revokeInvite } from '../../../server/fns'
import { invitesQuery } from '../../queries'
import { useWorkspaceSlug } from '../../workspace'
import { signalProductTourProgress } from '../../productTour'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { CopyButtonLabel, useCopied } from '../useCopied'
import { SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function InviteDialog({ smtpConfigured, onDone }: { smtpConfigured: boolean; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const callCreateInvite = useServerFn(createInvite)
  const queryClient = useQueryClient()
  const [link, setLink] = useState('')
  const [emailedTo, setEmailedTo] = useState<string>()
  const { copied, copy } = useCopied()
  const { t } = useI18n()
  const text = t.settings.invites
  const roleOptions = [
    { value: 'requester', label: text.roles.requester },
    { value: 'admin', label: text.roles.admin },
  ] as const
  const mutation = useMutation({
    mutationFn: callCreateInvite,
    onSuccess: async ({ token, emailed }, variables) => {
      setLink(`${window.location.origin}/invite/${token}`)
      setEmailedTo(emailed ? variables.data.email : undefined)
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
      signalProductTourProgress('invite')
    },
  })
  const form = useForm({
    defaultValues: { role: 'requester' as 'requester' | 'admin', label: '', email: '' },
    onSubmit: ({ value }) =>
      mutation.mutateAsync({
        data: { workspaceSlug, role: value.role, label: value.label.trim() || undefined, email: value.email.trim() || undefined },
      }),
  })

  if (link) {
    return (
      <DialogShell title={text.link.title} onClose={onDone}>
        <p className="text-sm text-muted-foreground">{text.link.description}</p>
        {emailedTo && <SettingNotice notice={{ tone: 'success', title: text.link.emailed, hint: text.link.emailedHint(emailedTo) }} />}
        <Field>
          <FieldLabel htmlFor="invite-link">{text.link.label}</FieldLabel>
          <InputGroup>
            <InputGroupInput id="invite-link" readOnly value={link} onFocus={(event) => event.target.select()} />
            <InputGroupButton variant="ghost" onClick={() => copy(link)}>
              <CopyButtonLabel copied={copied} />
            </InputGroupButton>
          </InputGroup>
          <FieldDescription>{text.link.shownOnce}</FieldDescription>
        </Field>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            {t.common.done}
          </Button>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell title={text.create.title} onClose={onDone}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="flex flex-col gap-3"
      >
        {smtpConfigured && (
          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="invite-email">{text.create.emailLabel}</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  maxLength={254}
                  placeholder={text.create.emailPlaceholder}
                />
                <FieldDescription>{text.create.emailHint}</FieldDescription>
              </Field>
            )}
          </form.Field>
        )}
        <form.Field name="label">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-label">{text.create.labelLabel}</FieldLabel>
              <Input
                id="invite-label"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={100}
                placeholder={text.create.labelPlaceholder}
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-role">{text.create.roleLabel}</FieldLabel>
              <Select
                items={roleOptions}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as 'requester' | 'admin')}
              >
                <SelectTrigger className="w-full" id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <DialogProblem
          title={text.create.notCreated}
          hint={text.create.notCreatedHint}
          error={mutation.error ? (noticeDetail(mutation.error) ?? text.create.noDetail) : undefined}
        />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? text.create.creating : smtpConfigured ? text.create.submitEmail : text.create.title}
              </Button>
            </div>
          )}
        </form.Subscribe>
      </form>
    </DialogShell>
  )
}

export function PendingInvites() {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(invitesQuery(workspaceSlug))
  const invites = query.data
  const callRevoke = useServerFn(revokeInvite)
  const queryClient = useQueryClient()
  const mutation = useMutation({ mutationFn: callRevoke, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }) })
  const { t, locale } = useI18n()
  const text = t.settings.invites.pending
  if (!invites) {
    return (
      <SettingsSection title={text.title}>
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel={text.loading}
          errorTitle={text.loadError}
          onRetry={() => void query.refetch()}
        />
      </SettingsSection>
    )
  }
  if (!invites.length) return null
  return (
    <SettingsSection title={text.title}>
      <ItemGroup>
        {invites.map((invite) => (
          <Item variant="outline" key={invite.id}>
            <ItemContent>
              <ItemTitle>{invite.label || text.unlabeled}</ItemTitle>
              <ItemDescription>{text.expires(new Date(invite.expiresAt).toLocaleDateString(locale))}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">{text.role[invite.role]}</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mutation.isPending && mutation.variables?.data.id === invite.id}
                onClick={() => mutation.mutate({ data: { workspaceSlug, id: invite.id } })}
              >
                {text.revoke}
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: text.notRevoked,
            hint: text.notRevokedHint,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
