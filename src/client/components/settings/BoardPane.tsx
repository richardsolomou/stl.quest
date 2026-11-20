import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useServerFn } from '@tanstack/react-start'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { DEFAULT_AUTO_ARCHIVE_DAYS, MAX_AUTO_ARCHIVE_DAYS, validAutoArchiveDays } from '../../../core/autoArchive'
import { PRINT_TYPE_CHOICES, workspacePrintTypes, type PrintTypeChoice } from '../../../core/printTypes'
import type { Identity } from '../../../core/types'
import { deleteWorkspace, updateBoardSettings, updatePrintTypeChoice } from '../../../server/fns'
import { boardQuery, sessionQuery } from '../../queries'
import { reloadAfterWorkspaceChange, useUsageTracking, useWorkspaceSlug } from '../../workspace'
import { useAutosavedDraft } from '../../useAutosave'
import { ConfirmDialog } from '../ConfirmDialog'
import { QueryState } from '../QueryState'
import { useSetUsageTracking } from '../UsageTracking'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'
import { useI18n } from '../../i18n'

export function BoardPane({ me, workspaceName, workspaceCount }: { me: Identity; workspaceName: string; workspaceCount: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(boardQuery(workspaceSlug))
  const current = query.data
  const callDelete = useServerFn(deleteWorkspace)
  const { t } = useI18n()
  const copy = t.settings.board
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
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

  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      <VisibilitySection privateRequests={current.privateRequests} overrideCount={overrideCount} />
      <PrintTypesSection />
      <UsageTrackingSection />
      <AutoArchiveSection autoArchiveDays={current.autoArchiveDays} />
      {canDeleteWorkspace && (
        <SettingsSection tone="danger" title={copy.danger.title} description={copy.danger.description}>
          {onlyWorkspace ? (
            // Nothing can be done here yet, so there is no button to tap: just what is blocked and why.
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h3 className="font-medium">{copy.danger.heading(workspaceName)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{copy.danger.onlyWorkspace}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
              <div>
                <h3 className="font-medium">{copy.danger.heading(workspaceName)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{copy.danger.irreversible}</p>
              </div>
              <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                {copy.danger.action}
              </Button>
            </div>
          )}
        </SettingsSection>
      )}
      <ConfirmDialog
        open={deleteOpen}
        title={copy.danger.dialogTitle(workspaceName)}
        description={copy.danger.dialogDescription}
        details={
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
        }
        confirmLabel={copy.danger.action}
        pendingLabel={copy.danger.deleting}
        destructive
        pending={deleteMutation.isPending}
        confirmDisabled={confirmation !== workspaceName}
        onConfirm={() => deleteMutation.mutate({ data: { workspaceSlug, confirmation } })}
        onCancel={() => {
          setDeleteOpen(false)
          setConfirmation('')
          deleteMutation.reset()
        }}
      />
    </SettingsPage>
  )
}

/** Who sees whose requests, saved as soon as it is picked. */
function VisibilitySection({ privateRequests, overrideCount }: { privateRequests: boolean; overrideCount: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateBoardSettings)
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.board
  const visibilityOptions = [
    { value: 'shared', label: copy.visibility.shared },
    { value: 'private', label: copy.visibility.private },
  ] as const
  const { draft, setDraft, bind } = useAutosavedDraft(privateRequests, {
    save: async (next) => {
      await callUpdate({ data: { workspaceSlug, privateRequests: next } })
      await queryClient.invalidateQueries({ queryKey: ['board-settings'] })
    },
  })
  return (
    <SettingsSection {...bind} title={copy.visibility.title}>
      <Field>
        <FieldLabel htmlFor="board-visibility">{copy.visibility.label}</FieldLabel>
        <Select items={visibilityOptions} value={draft ? 'private' : 'shared'} onValueChange={(value) => setDraft(value === 'private')}>
          <SelectTrigger className="w-full" id="board-visibility">
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
    </SettingsSection>
  )
}

/** What the workspace prints, which every print-type choice narrows to; automatic follows the printers. */
function PrintTypesSection() {
  const workspaceSlug = useWorkspaceSlug()
  const { printTypeChoice, printers } = useSuspenseQuery(sessionQuery(workspaceSlug)).data
  const callUpdate = useServerFn(updatePrintTypeChoice)
  const queryClient = useQueryClient()
  const copy = useI18n().t.settings.board.printTypes
  const { draft, setDraft, bind } = useAutosavedDraft<PrintTypeChoice>(printTypeChoice, {
    save: async (choice) => {
      await callUpdate({ data: { workspaceSlug, choice } })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })
  const fleet = printers.length ? workspacePrintTypes('automatic', printers) : []
  const automatic = fleet.length === 0 ? copy.automatic.none : fleet.length > 1 ? copy.automatic.both : copy.automatic[fleet[0]]
  return (
    <SettingsSection {...bind} title={copy.title} description={copy.description}>
      <Field>
        <SegmentedControl
          legend={copy.title}
          className="grid w-full grid-cols-2 sm:flex sm:w-md"
          value={draft}
          options={PRINT_TYPE_CHOICES.map((value) => ({ value, label: copy.choices[value], id: `print-types-${value}` }))}
          onChange={setDraft}
        />
        {draft === 'automatic' && <FieldDescription>{automatic}</FieldDescription>}
      </Field>
    </SettingsSection>
  )
}

/** Whether the workspace asks what each step used, which stock, maintenance, and spend are counted from. */
function UsageTrackingSection() {
  const copy = useI18n().t.settings.board.tracking
  const setTracking = useSetUsageTracking()
  const { draft, setDraft, bind } = useAutosavedDraft(useUsageTracking(), { save: (enabled) => setTracking(enabled, 'settings') })
  return (
    <SettingsSection {...bind} title={copy.title} description={copy.description}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="usage-tracking">{copy.label}</FieldLabel>
          <FieldDescription>{copy.help}</FieldDescription>
        </FieldContent>
        <Switch id="usage-tracking" data-onboarding="tracking" checked={draft} onCheckedChange={setDraft} />
      </Field>
    </SettingsSection>
  )
}

/** Whether finished prints archive themselves and after how many days, saved as it is edited. */
function AutoArchiveSection({ autoArchiveDays }: { autoArchiveDays?: number }) {
  const workspaceSlug = useWorkspaceSlug()
  const callUpdate = useServerFn(updateBoardSettings)
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const copy = t.settings.board
  const stored = useMemo(
    () => ({ enabled: autoArchiveDays !== undefined, days: String(autoArchiveDays ?? DEFAULT_AUTO_ARCHIVE_DAYS) }),
    [autoArchiveDays],
  )
  const { draft, setDraft, bind } = useAutosavedDraft(stored, {
    valid: ({ enabled, days }) => !enabled || validAutoArchiveDays(Number(days)),
    save: async ({ enabled, days }) => {
      await callUpdate({ data: { workspaceSlug, autoArchiveDays: enabled ? Number(days) : null } })
      await queryClient.invalidateQueries({ queryKey: ['board-settings'] })
    },
  })
  const valid = validAutoArchiveDays(Number(draft.days))
  return (
    <SettingsSection {...bind} title={copy.archive.title}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="auto-archive-enabled">{copy.archive.label}</FieldLabel>
          <FieldDescription>{copy.archive.description}</FieldDescription>
        </FieldContent>
        <Switch
          id="auto-archive-enabled"
          checked={draft.enabled}
          onCheckedChange={(enabled) =>
            setDraft((current) => ({ enabled, days: enabled && !valid ? String(DEFAULT_AUTO_ARCHIVE_DAYS) : current.days }))
          }
        />
      </Field>
      {draft.enabled && (
        <Field className="w-40" data-invalid={!valid || undefined}>
          <FieldLabel htmlFor="auto-archive-days">{copy.archive.daysLabel}</FieldLabel>
          <Input
            id="auto-archive-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_AUTO_ARCHIVE_DAYS}
            step={1}
            value={draft.days}
            aria-invalid={!valid}
            onChange={(event) => setDraft((current) => ({ ...current, days: event.target.value }))}
          />
        </Field>
      )}
      {draft.enabled && !valid && <FieldError>{copy.archive.invalidDays(MAX_AUTO_ARCHIVE_DAYS)}</FieldError>}
    </SettingsSection>
  )
}
