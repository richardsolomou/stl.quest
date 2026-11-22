import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { Disc3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { consumablesOfKind, type FilamentConsumable } from '../../../core/consumables'
import { spoolmanBridgeCompose } from '../../../core/spoolman'
import { connectSpoolman, disconnectSpoolman, linkSpoolmanFilament } from '../../../server/fns'
import { useI18n } from '../../i18n'
import { consumablesQuery, spoolmanQuery, type SpoolmanView } from '../../queries'
import { invalidateQueries } from '../../queryState'
import { REPOSITORY_URL } from '../../sourceCode'
import { useUsageTracking, useWorkspaceSlug } from '../../workspace'
import { ColourSwatch } from '../ColourSwatch'
import { ConfirmDialog } from '../ConfirmDialog'
import { CopyableValue } from '../CopyableValue'
import { QueryState } from '../QueryState'
import { SettingNotice, errorNotice } from '../SettingNotice'
import { SettingRow } from '../SettingRow'
import { UsageTrackingInvite } from '../UsageTracking'
import { CopyButtonLabel, useCopied } from '../useCopied'
import { formatQuantity } from './ConsumableStock'
import { PageHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const DOCS_URL = `${REPOSITORY_URL}/blob/main/docs/spoolman.md`

export function SpoolmanPane() {
  const workspaceSlug = useWorkspaceSlug()
  const query = useQuery(spoolmanQuery(workspaceSlug))
  const copy = useI18n().t.settings.spoolman
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
  return <SpoolmanSettings workspaceSlug={workspaceSlug} spoolman={query.data} />
}

function SpoolmanSettings({ workspaceSlug, spoolman }: { workspaceSlug: string; spoolman: SpoolmanView }) {
  const { t, locale } = useI18n()
  const copy = t.settings.spoolman
  const [token, setToken] = useState<string>()
  const [confirming, setConfirming] = useState<'replace' | 'disconnect'>()
  const callConnect = useServerFn(connectSpoolman)
  const callDisconnect = useServerFn(disconnectSpoolman)
  const queryClient = useQueryClient()
  // The page shows what these change, so it refreshes now rather than waiting on the realtime channel.
  const refresh = () => invalidateQueries(queryClient, 'spoolman', 'stock')
  const connect = useMutation({
    mutationFn: callConnect,
    onSuccess: ({ token: created }) => {
      setToken(created)
      return refresh()
    },
  })
  const disconnect = useMutation({
    mutationFn: callDisconnect,
    onSuccess: () => {
      setToken(undefined)
      return refresh()
    },
  })
  const pending = connect.isPending || disconnect.isPending
  const { connection, filaments } = spoolman
  const spoolCount = filaments.reduce((total, filament) => total + filament.spools, 0)
  const when = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const status = !connection
    ? { label: copy.connection.status.off, tone: 'off' as const }
    : connection.receivedAt
      ? { label: copy.connection.status.receiving, tone: 'on' as const }
      : { label: copy.connection.status.waiting, tone: 'ready' as const }
  const detail = !connection
    ? copy.connection.off
    : connection.receivedAt
      ? copy.connection.received(when.format(connection.receivedAt), copy.filaments.spools(spoolCount))
      : copy.connection.waiting
  const confirm = () => {
    const action = confirming === 'replace' ? connect : disconnect
    action.mutate({ data: { workspaceSlug } }, { onSuccess: () => setConfirming(undefined) })
  }
  return (
    <SettingsPage>
      <PageHeader title={copy.title} description={copy.description} />
      <SettingsSection title={copy.connection.title} description={copy.connection.description}>
        <div className="grid gap-4">
          <SettingRow
            icon={<Disc3 />}
            name={copy.connection.name}
            status={status}
            detail={detail}
            actions={
              connection ? (
                <>
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirming('replace')}>
                    {copy.connection.replace}
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirming('disconnect')}>
                    {copy.connection.disconnect}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" disabled={pending} onClick={() => connect.mutate({ data: { workspaceSlug } })}>
                  {connect.isPending && <Spinner />} {copy.connection.create}
                </Button>
              )
            }
          />
          {token && <CopyableValue label={copy.connection.token} value={token} description={copy.connection.tokenHint} />}
          {(connect.error || disconnect.error) && !confirming && (
            <SettingNotice notice={errorNotice(copy.connection.error, '', connect.error ?? disconnect.error)} />
          )}
        </div>
      </SettingsSection>
      {connection && (
        <SettingsSection title={copy.bridge.title} description={copy.bridge.description}>
          <div className="grid gap-4">
            <CopyableBlock
              label={copy.bridge.compose}
              value={spoolmanBridgeCompose(spoolman.appUrl, token)}
              hint={copy.bridge.spoolmanUrl}
            />
            <CopyableValue label={copy.bridge.endpoint} value={spoolman.ingestUrl} description={copy.bridge.endpointHint} />
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">
              {copy.bridge.docs}
            </a>
          </div>
        </SettingsSection>
      )}
      {(connection || filaments.length > 0) && <FilamentLinks workspaceSlug={workspaceSlug} filaments={filaments} />}
      <ConfirmDialog
        open={confirming !== undefined}
        title={confirming === 'replace' ? copy.connection.replaceConfirm.title : copy.connection.disconnectConfirm.title}
        description={confirming === 'replace' ? copy.connection.replaceConfirm.description : copy.connection.disconnectConfirm.description}
        confirmLabel={confirming === 'replace' ? copy.connection.replaceConfirm.confirm : copy.connection.disconnectConfirm.confirm}
        destructive={confirming === 'disconnect'}
        pending={pending}
        problem={(connect.error || disconnect.error) && confirming ? { title: copy.connection.error, hint: '' } : undefined}
        onConfirm={confirm}
        onCancel={() => setConfirming(undefined)}
      />
    </SettingsPage>
  )
}

function CopyableBlock({ label, value, hint }: { label: string; value: string; hint: string }) {
  const { t } = useI18n()
  const { copied, copy } = useCopied()
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <Button type="button" variant="outline" size="sm" aria-label={t.shell.copyValue(label)} onClick={() => copy(value)}>
          <CopyButtonLabel copied={copied} />
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">{value}</pre>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

// Base UI reserves an empty value for no selection, so automatic matching needs its own value.
const AUTO = 'auto'
const NONE = 'none'

function FilamentLinks({ workspaceSlug, filaments }: { workspaceSlug: string; filaments: SpoolmanView['filaments'] }) {
  const { t, locale } = useI18n()
  const copy = t.settings.spoolman.filaments
  const tracking = useUsageTracking()
  const library = consumablesOfKind(useQuery(consumablesQuery(workspaceSlug)).data?.consumables ?? [], 'filament')
  const queryClient = useQueryClient()
  const link = useMutation({
    mutationFn: useServerFn(linkSpoolmanFilament),
    onSuccess: () => invalidateQueries(queryClient, 'spoolman', 'stock'),
  })
  return (
    <SettingsSection title={copy.title} description={copy.description} layout="stacked">
      {!tracking && <UsageTrackingInvite source="spoolman" line={t.settings.board.tracking.invite.spoolman} className="mb-1" />}
      {filaments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="grid divide-y">
          {filaments.map((filament) => (
            <FilamentRow
              key={filament.id}
              filament={filament}
              library={library}
              remaining={formatQuantity(filament.remainingGrams, 'g', locale)}
              disabled={link.isPending}
              onChoose={(choice) => link.mutate({ data: { workspaceSlug, filamentId: filament.id, choice } })}
            />
          ))}
        </ul>
      )}
      {filaments.length > 0 && library.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {copy.noLibrary}{' '}
          <Link to="/settings/$section" params={{ section: 'consumables' }} className="underline underline-offset-2">
            {t.settings.sections.consumables}
          </Link>
        </p>
      )}
      {link.error != null && <SettingNotice notice={errorNotice(copy.error, '', link.error)} />}
    </SettingsSection>
  )
}

function FilamentRow({
  filament,
  library,
  remaining,
  disabled,
  onChoose,
}: {
  filament: SpoolmanView['filaments'][number]
  library: FilamentConsumable[]
  remaining: string
  disabled: boolean
  onChoose: (choice: string) => void
}) {
  const copy = useI18n().t.settings.spoolman.filaments
  const name = [filament.vendor, filament.name ?? copy.unnamed(filament.id)].filter(Boolean).join(' ')
  const automatic = library.find(({ id }) => id === filament.automatic)?.name
  const options = [
    { value: AUTO, label: copy.automatic(automatic), hex: undefined as string | undefined },
    { value: NONE, label: copy.none, hex: undefined },
    ...library.map((item) => ({ value: item.id, label: item.name, hex: item.colour?.hex })),
  ]
  const chosen = options.find(({ value }) => value === filament.choice)
  const selectId = `spoolman-filament-${filament.id}`
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        {filament.colourHex ? <ColourSwatch hex={filament.colourHex} className="mt-1 size-4" /> : <span className="size-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold [overflow-wrap:anywhere]">{name}</p>
          <p className="text-sm text-muted-foreground">
            {[filament.material, copy.spools(filament.spools), filament.match && copy.by[filament.match.by]].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{remaining}</span>
      </div>
      <Select items={options} value={filament.choice} disabled={disabled} onValueChange={(value) => value && onChoose(value)}>
        <SelectTrigger className="w-full" id={selectId} aria-label={copy.countsTowards(name)}>
          <SelectValue>
            {chosen?.hex && <ColourSwatch hex={chosen.hex} />}
            <span className="truncate">{chosen?.label ?? copy.none}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.hex && <ColourSwatch hex={option.hex} className="self-center" />}
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  )
}
