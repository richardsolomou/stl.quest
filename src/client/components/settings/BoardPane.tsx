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
import { useI18n } from '../../i18n'

export function BoardPane({ me, workspaceName, workspaceCount }: { me: Identity; workspaceName: string; workspaceCount: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(boardQuery(workspaceSlug))
  const current = query.data
  const callUpdate = useServerFn(updateBoardSettings)
  const callDelete = useServerFn(deleteWorkspace)
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.board
  const visibilityOptions = [
    { value: 'shared', label: copy.visibility.shared },
    { value: 'private', label: copy.visibility.private },
  ] as const
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

  return (
    <SettingsPage>
      <SettingsHeader title={copy.title} description={copy.description} />
      <SettingsSection>
        <Field>
          <FieldLabel htmlFor="board-visibility">{copy.visibility.label}</FieldLabel>
          <Select
            items={visibilityOptions}
            value={current.privateRequests ? 'private' : 'shared'}
            disabled={mutation.isPending}
            onValueChange={(value) => mutation.mutate({ data: { workspaceSlug, privateRequests: value === 'private' } })}
          >
            <SelectTrigger className="w-full" id="board-visibility" data-onboarding="visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibilityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {copy.visibility.help.before}
            <Link to="/settings/$section" params={{ section: 'users' }} className="underline underline-offset-2">
              {copy.visibility.help.link}
            </Link>
            {copy.visibility.help.after}
            {overrideCount > 0 && ` ${copy.visibility.overrides(overrideCount)}`}
          </FieldDescription>
        </Field>
        {mutation.error && (
          <SettingNotice
            notice={{
              tone: 'error',
              title: copy.visibility.notSaved,
              hint: copy.previousSettingKept,
              detail: noticeDetail(mutation.error),
            }}
          />
        )}
      </SettingsSection>
      <AutoArchiveSection autoArchiveDays={current.autoArchiveDays} />
      {canDeleteWorkspace && (
        <SettingsSection tone="danger" title={copy.danger.title} description={copy.danger.description}>
          <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
            <div>
              <h3 className="font-medium">{copy.danger.heading(workspaceName)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{onlyWorkspace ? copy.danger.onlyWorkspace : copy.danger.irreversible}</p>
            </div>
            <Button type="button" variant="destructive" disabled={onlyWorkspace} onClick={() => setDeleteOpen(true)}>
              {copy.danger.action}
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
            <AlertDialogTitle>{copy.danger.dialogTitle(workspaceName)}</AlertDialogTitle>
            <AlertDialogDescription>{copy.danger.dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-workspace-confirmation">{copy.danger.nameLabel}</FieldLabel>
            <Input
              id="delete-workspace-confirmation"
              value={confirmation}
              disabled={deleteMutation.isPending}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <FieldDescription>{copy.danger.nameHint(workspaceName)}</FieldDescription>
            <FieldError>{deleteMutation.error?.message}</FieldError>
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirmation !== workspaceName || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate({ data: { workspaceSlug, confirmation } })}
            >
              {deleteMutation.isPending && <Spinner />}
              {deleteMutation.isPending ? copy.danger.deleting : copy.danger.action}
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
  const { t } = useI18n()
  const copy = t.settings.board
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
    <SettingsSection title={copy.archive.title}>
      <UnsavedChangesGuard dirty={dirty} />
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="auto-archive-enabled">{copy.archive.label}</FieldLabel>
          <FieldDescription>{copy.archive.description}</FieldDescription>
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
            <FieldLabel htmlFor="auto-archive-days">{copy.archive.daysLabel}</FieldLabel>
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
            {t.common.save}
          </Button>
        </form>
      )}
      {enabled && !valid && <FieldError>{copy.archive.invalidDays(MAX_AUTO_ARCHIVE_DAYS)}</FieldError>}
      {mutation.error && (
        <SettingNotice
          notice={{
            tone: 'error',
            title: copy.archive.notSaved,
            hint: copy.previousSettingKept,
            detail: noticeDetail(mutation.error),
          }}
        />
      )}
    </SettingsSection>
  )
}
