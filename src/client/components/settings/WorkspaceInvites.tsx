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
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { CopyButtonLabel, useCopied } from '../useCopied'
import { SettingsSection } from './SettingsLayout'

const ROLE_OPTIONS = [
  { value: 'requester', label: 'Requester' },
  { value: 'admin', label: 'Admin' },
] as const

export function InviteDialog({ smtpConfigured, onDone }: { smtpConfigured: boolean; onDone: () => void }) {
  const workspaceSlug = useWorkspaceSlug()
  const callCreateInvite = useServerFn(createInvite)
  const queryClient = useQueryClient()
  const [link, setLink] = useState('')
  const [emailedTo, setEmailedTo] = useState<string>()
  const { copied, copy } = useCopied()
  const mutation = useMutation({
    mutationFn: callCreateInvite,
    onSuccess: async ({ token, emailed }, variables) => {
      setLink(`${window.location.origin}/invite/${token}`)
      setEmailedTo(emailed ? variables.data.email : undefined)
      await queryClient.invalidateQueries({ queryKey: ['invites'] })
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
      <DialogShell title="Invite link" onClose={onDone}>
        <p className="text-sm text-muted-foreground">Share this single-use link with one person. It expires in seven days.</p>
        {emailedTo && (
          <SettingNotice
            notice={{ tone: 'success', title: 'Invitation emailed', hint: `Sent to ${emailedTo}. The link below is the same one.` }}
          />
        )}
        <Field>
          <FieldLabel htmlFor="invite-link">Invite link — share it with one person; it works once and expires in 7 days</FieldLabel>
          <InputGroup>
            <InputGroupInput id="invite-link" readOnly value={link} onFocus={(event) => event.target.select()} />
            <InputGroupButton variant="ghost" onClick={() => copy(link)}>
              <CopyButtonLabel copied={copied} />
            </InputGroupButton>
          </InputGroup>
          <FieldDescription>
            This is the only time the link is shown. They can continue with a password, Google, or Discord.
          </FieldDescription>
        </Field>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell title="Create invite link" onClose={onDone}>
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
                <FieldLabel htmlFor="invite-email">Email invitation to (optional)</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  maxLength={254}
                  placeholder="person@example.com"
                />
                <FieldDescription>Leave blank to create a link without sending email.</FieldDescription>
              </Field>
            )}
          </form.Field>
        )}
        <form.Field name="label">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-label">Who is this for? (optional note to yourself)</FieldLabel>
              <Input
                id="invite-label"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                maxLength={100}
                placeholder="New team member"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select
                items={ROLE_OPTIONS}
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as 'requester' | 'admin')}
              >
                <SelectTrigger className="w-full" id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => (
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
          title="The invite was not created"
          hint="Check the email address if you entered one, then try again."
          error={mutation.error ? (noticeDetail(mutation.error) ?? 'No further detail was returned.') : undefined}
        />
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={onDone}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                {busy ? 'Creating…' : smtpConfigured ? 'Create invitation' : 'Create invite link'}
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
  if (!invites) {
    return (
      <SettingsSection title="Pending invites">
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading pending invites…"
          errorTitle="Could not load pending invites"
          onRetry={() => void query.refetch()}
        />
      </SettingsSection>
    )
  }
  if (!invites.length) return null
  return (
    <SettingsSection title="Pending invites">
      <ItemGroup>
        {invites.map((invite) => (
          <Item variant="outline" key={invite.id}>
            <ItemContent>
              <ItemTitle>{invite.label || 'Unlabeled invite'}</ItemTitle>
              <ItemDescription>Expires {new Date(invite.expiresAt).toLocaleDateString()}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">{invite.role}</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mutation.isPending && mutation.variables?.data.id === invite.id}
                onClick={() => mutation.mutate({ data: { workspaceSlug, id: invite.id } })}
              >
                Revoke
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'The invite was not revoked',
            hint: 'It is still listed above and still usable. Try again in a moment.',
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
