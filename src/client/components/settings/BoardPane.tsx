import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_AUTO_ARCHIVE_DAYS, MAX_AUTO_ARCHIVE_DAYS, validAutoArchiveDays } from '../../../core/autoArchive'
import type { Identity } from '../../../core/types'
import { deleteWorkspace, updateBoardSettings } from '../../../server/fns'
import { boardQuery } from '../../queries'
import { reloadAfterWorkspaceChange, useWorkspaceSlug } from '../../workspace'
import { signalProductTourProgress } from '../../productTour'
import { QueryState } from '../QueryState'
import { SettingNotice, noticeDetail } from '../SettingNotice'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { UnsavedChangesGuard } from './UnsavedChangesGuard'

const BOARD_DESCRIPTION = 'Control how requests are shared between admins and requesters, and when finished prints leave the board.'

const VISIBILITY_OPTIONS = [
  { value: 'shared', label: 'Shared — everyone sees every request' },
  { value: 'private', label: 'Private — requesters see only their own' },
] as const

export function BoardPane({ me, workspaceName, workspaceCount }: { me: Identity; workspaceName: string; workspaceCount: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(boardQuery(workspaceSlug))
  const current = query.data
  const callUpdate = useServerFn(updateBoardSettings)
  const callDelete = useServerFn(deleteWorkspace)
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  // The selected option is the confirmation that it saved; only a failure needs saying out loud.
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: () => {
      signalProductTourProgress('visibility')
      return queryClient.invalidateQueries({ queryKey: ['board-settings'] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: callDelete,
    onSuccess: reloadAfterWorkspaceChange,
  })
  const canDeleteWorkspace = me.workspaceRole === 'owner'
  const overrideCount = Object.keys(current?.memberVisibility ?? {}).length
  const onlyWorkspace = workspaceCount <= 1
  if (!current) {
    return (
      <SettingsPage>
        <SettingsHeader title="Board" description={BOARD_DESCRIPTION} />
        <QueryState
          loading={query.isPending}
          error={query.error}
          loadingLabel="Loading board settings…"
          errorTitle="Could not load board settings"
          onRetry={() => void query.refetch()}
        />
      </SettingsPage>
    )
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Board" description={BOARD_DESCRIPTION} />
      <SettingsSection>
        <Field>
          <FieldLabel htmlFor="board-visibility">Request visibility</FieldLabel>
          <Select
            items={VISIBILITY_OPTIONS}
            value={current.privateRequests ? 'private' : 'shared'}
            disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate({ data: { workspaceSlug, privateRequests: value === 'private' } })}
          >
            <SelectTrigger className="w-full" id="board-visibility" data-onboarding="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Private suits print farms and paid work: requesters see, reorder, and withdraw only their own requests. Admins always see
            everything. This is the default for every member; give someone a narrower or wider view from{' '}
            <Link to="/settings/$section" params={{ section: 'users' }} className="underline underline-offset-2">
              Members
            </Link>
            .{overrideCount > 0 && ` ${overrideCount} ${overrideCount === 1 ? 'member has' : 'members have'} their own setting.`}
          </FieldDescription>
        </Field>
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: 'Visibility was not changed',
              hint: 'The board is still using the previous setting. Try again in a moment.',
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
      <AutoArchiveSection autoArchiveDays={current.autoArchiveDays} />
      {canDeleteWorkspace && (
        <SettingsSection
          tone="danger"
          title="Danger zone"
          description="Permanently remove this workspace, its requests, settings, members, and locally stored workspace files. Connected cloud storage may retain files."
        >
          <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
            <div>
              <h3 className="font-medium">Delete {workspaceName}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {onlyWorkspace ? 'Create another workspace before deleting this one.' : 'This cannot be undone.'}
              </p>
            </div>
            <Button type="button" variant="destructive" disabled={onlyWorkspace} onClick={() => setDeleteOpen(true)}>
              Delete workspace
            </Button>
          </div>
        </SettingsSection>
      )}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (open || deleteMutation.isPending) return
          setDeleteOpen(false)
          setConfirmation('')
          deleteMutation.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {workspaceName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workspace and its STL Quest data. Type the workspace name to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-workspace-confirmation">Workspace name</FieldLabel>
            <Input
              id="delete-workspace-confirmation"
              value={confirmation}
              disabled={deleteMutation.isPending}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <FieldDescription>Enter {workspaceName} exactly.</FieldDescription>
            <FieldError>{deleteMutation.error?.message}</FieldError>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmation !== workspaceName || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ data: { workspaceSlug, confirmation } })}
            >
              {deleteMutation.isPending && <Spinner />}
              {deleteMutation.isPending ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}

function AutoArchiveSection({ autoArchiveDays }: { autoArchiveDays?: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateBoardSettings)
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(String(autoArchiveDays ?? DEFAULT_AUTO_ARCHIVE_DAYS))
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: (config) => {
      setDraft(String(config.autoArchiveDays ?? DEFAULT_AUTO_ARCHIVE_DAYS))
      return queryClient.invalidateQueries({ queryKey: ['board-settings'] })
    },
  })
  const enabled = autoArchiveDays !== undefined
  const days = Number(draft)
  const valid = validAutoArchiveDays(days)
  const dirty = enabled && draft !== String(autoArchiveDays)
  const save = (next: number | null) => mutation.mutate({ data: { workspaceSlug, autoArchiveDays: next } })
  return (
    <SettingsSection title="Archive">
      <UnsavedChangesGuard dirty={dirty} />
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="auto-archive-enabled">Archive Ready prints automatically</FieldLabel>
          <FieldDescription>Move a print to the archive once every copy has been Ready for a set number of days.</FieldDescription>
        </FieldContent>
        <Switch
          id="auto-archive-enabled"
          checked={enabled}
          disabled={mutation.isPending}
          onCheckedChange={(checked) => save(checked ? (valid ? days : DEFAULT_AUTO_ARCHIVE_DAYS) : null)}
        />
      </Field>
      {enabled && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (valid && dirty) save(days)
          }}
        >
          <Field className="w-40" data-invalid={!valid || undefined}>
            <FieldLabel htmlFor="auto-archive-days">Days after Ready</FieldLabel>
            <Input
              id="auto-archive-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_AUTO_ARCHIVE_DAYS}
              step={1}
              value={draft}
              disabled={mutation.isPending}
              aria-invalid={!valid}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!valid || !dirty || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            Save
          </Button>
        </form>
      )}
      {enabled && !valid && <FieldError>Enter a whole number of days from 1 to {MAX_AUTO_ARCHIVE_DAYS}.</FieldError>}
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: 'Automatic archiving was not changed',
            hint: 'The board is still using the previous setting. Try again in a moment.',
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
