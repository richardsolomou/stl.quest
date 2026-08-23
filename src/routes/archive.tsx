import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ArchiveRestore, ArchiveX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccountRouteShell } from '../client/components/AccountRouteShell'
import { LazyThumb } from '../client/components/LazyThumb'
import { QueryState } from '../client/components/QueryState'
import { UserAvatar } from '../client/components/UserAvatar'
import { requesterLabel } from '../client/requester'
import { requestsQuery, sessionQuery } from '../client/queries'
import { retryQueries } from '../client/queryState'
import { useWorkspaceSlug } from '../client/workspace'
import { errorMessage } from '../core/error'
import type { Identity, PublicPrintRequest } from '../core/types'
import { unarchiveRequests } from '../server/fns'

export const Route = createFileRoute('/archive')({ component: ArchivePage })

function ArchivePage() {
  const navigate = useNavigate()
  const { data: session } = useSuspenseQuery(sessionQuery())
  useEffect(() => {
    if (!session.identity) void navigate({ to: '/' })
  }, [session.identity, navigate])
  if (!session.identity) return null
  return <AccountRouteShell active="archive">{(identity) => <ArchiveView identity={identity} />}</AccountRouteShell>
}

function ArchiveView({ identity }: { identity: Identity }) {
  const workspaceSlug = useWorkspaceSlug()
  const queryClient = useQueryClient()
  const callUnarchiveRequests = useServerFn(unarchiveRequests)
  const { data: workspace } = useQuery(sessionQuery(workspaceSlug))
  const result = useQuery(requestsQuery(workspaceSlug, { archived: true }))
  const restoreMutation = useMutation({
    mutationFn: callUnarchiveRequests,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests', workspaceSlug] }),
  })
  if (result.isPending) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <QueryState
          loading
          error={undefined}
          loadingLabel="Loading archive…"
          errorTitle="Could not load the archive"
          onRetry={() => undefined}
        />
      </div>
    )
  }
  if (result.isError) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <QueryState
          loading={false}
          error={result.error}
          loadingLabel="Loading archive…"
          errorTitle="Could not load the archive"
          onRetry={() => void retryQueries(result.refetch)}
          className="w-full max-w-xl"
        />
      </div>
    )
  }
  const isAdmin = identity.role === 'admin'
  const showRequester = !workspace?.privateRequests || isAdmin
  const archivedRequests = [...result.data.requests].sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0))
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-xl font-semibold">Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived prints stay out of the board but keep their stage, files, and history. Move one back whenever you need it again.
        </p>
      </header>
      {archivedRequests.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-blueprint/25 p-10 text-center">
          <ArchiveX aria-hidden="true" className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing is archived yet. Right-click a print on the board and choose Archive.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {archivedRequests.map((request) => (
            <ArchivedRequestRow
              key={request.id}
              request={request}
              showRequester={showRequester}
              pending={restoreMutation.isPending}
              onRestore={() => restoreMutation.mutate({ data: { workspaceSlug, ids: [request.id] } })}
            />
          ))}
        </ul>
      )}
      {restoreMutation.isPending && <output className="text-sm text-muted-foreground">Moving back to the board…</output>}
      {restoreMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(restoreMutation.error, 'The print could not be moved back to the board.')}
        </p>
      )}
    </div>
  )
}

function ArchivedRequestRow({
  request,
  showRequester,
  pending,
  onRestore,
}: {
  request: PublicPrintRequest
  showRequester: boolean
  pending: boolean
  onRestore: () => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
      {request.hasThumbnail ? (
        <LazyThumb requestId={request.id} />
      ) : (
        <div className="thumb grid size-16 shrink-0 place-items-center overflow-hidden rounded-sm border border-ticket-foreground/15 bg-background [background-image:var(--grid)] [background-size:12px_12px]">
          <span className="font-mono text-[10px] text-muted-foreground">stl</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-base font-semibold">{request.name}</div>
        <div className="mt-1 flex items-center gap-x-2 text-xs text-muted-foreground">
          {showRequester && (
            <>
              <UserAvatar name={requesterLabel(request)} image={request.requesterImage} size="sm" />
              <span>{requesterLabel(request)}</span>
            </>
          )}
          <span className="font-mono">×{request.quantity}</span>
          {request.archivedAt && (
            <span title={`Archived ${formatDateTime(request.archivedAt)}`}>
              Archived <time dateTime={new Date(request.archivedAt).toISOString()}>{formatDate(request.archivedAt)}</time>
            </span>
          )}
        </div>
      </div>
      {request.canArchive && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRestore}>
          <ArchiveRestore />
          Move back
        </Button>
      )}
    </li>
  )
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value)
}

function formatDateTime(value: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
