import type { ReactNode } from 'react'
import { Check, ChevronRight, Folder } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { StorageConfig } from '../../../core/types'
import { storageLabel, type CloudProvider } from '../../storageProviders'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { StorageAdapterIcon } from '../StorageAdapterIcon'

export function StorageProviderPicker({
  cloudProviders,
  serverFolder,
  inUse,
  preparing,
  onUseServerFolder,
  onKeepCurrent,
  onChoose,
}: {
  cloudProviders: { value: CloudProvider; label: string }[]
  serverFolder?: string
  inUse?: StorageConfig
  preparing: boolean
  onUseServerFolder: () => void
  onKeepCurrent?: () => void
  onChoose: (adapter: StorageConfig['adapter']) => void
}) {
  const options: { value: StorageConfig['adapter']; label: string; effort: string; requires: string; icon: ReactNode }[] = [
    ...(inUse && serverFolder
      ? [
          {
            value: 'local' as const,
            label: 'A folder on this server',
            effort: 'Ready now',
            requires: `Writes to a folder on the machine running STL Quest, such as ${serverFolder}.`,
            icon: <StorageAdapterIcon adapter="local" className="size-5" />,
          },
        ]
      : []),
    {
      value: 's3',
      label: 'S3-compatible bucket',
      effort: 'About 5 minutes',
      requires: 'Needs a bucket and access keys from Amazon S3, Cloudflare R2, Backblaze, MinIO, or a similar provider.',
      icon: <StorageAdapterIcon adapter="s3" className="size-5" />,
    },
    {
      value: 'webdav',
      label: 'Remote folder over WebDAV',
      effort: 'About 10 minutes',
      requires: 'Needs a WebDAV server on your own machine or NAS, reachable over HTTPS.',
      icon: <StorageAdapterIcon adapter="webdav" className="size-5" />,
    },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <h3 className="font-heading text-xl font-semibold">{inUse ? 'Change where your models live' : 'Choose where your models live'}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {inUse
            ? 'Nothing has been uploaded yet, so switching now costs nothing. Pick a different location, or keep the one you already set up.'
            : serverFolder
              ? 'Uploads are written straight into storage you own, and STL Quest never keeps a second copy. Connect one location and the board is ready for prints.'
              : 'Hosted workspaces write uploads into storage you own, so your models never live on STL Quest servers. Connect one location and the board is ready for prints.'}
        </p>
      </div>
      {inUse && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 max-sm:flex-col max-sm:items-stretch sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Check className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Storage is set up</span>
              <Badge>In use</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Models go to <code className="break-all">{storageLabel(inUse)}</code>.
            </p>
            <div className="mt-3">
              <Button type="button" disabled={preparing} onClick={onKeepCurrent}>
                Keep this and continue
              </Button>
            </div>
          </div>
        </div>
      )}
      {!inUse && serverFolder && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 max-sm:flex-col sm:p-4 max-sm:items-stretch">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Folder className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">This server’s own disk</span>
              <Badge>Ready now</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Models are written to <code className="break-all">{serverFolder}</code>. Nothing to sign up for, no keys to copy.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
              <Button type="button" disabled={preparing} onClick={onUseServerFolder}>
                {preparing && <Spinner />}
                {preparing ? 'Preparing storage…' : 'Use this folder'}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={preparing} onClick={() => onChoose('local')}>
                Pick another folder
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {inUse ? 'Switch to something else' : serverFolder ? 'Or connect storage you already use' : 'Connect storage you already use'}
        </h4>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={preparing}
            className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
            onClick={() => onChoose(option.value)}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground max-sm:hidden">
              {option.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{option.label}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  {option.effort}
                </Badge>
              </span>
              <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{option.requires}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden="true" />
          </button>
        ))}
        {cloudProviders.length > 0 && (
          <div className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Consumer cloud storage</span>
              <Badge variant="outline" className="text-muted-foreground">
                About 10 minutes
              </Badge>
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              Each provider needs its own app created in a developer console before STL Quest can connect.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2 max-sm:flex-col">
              {cloudProviders.map((provider) => (
                <Button key={provider.value} type="button" variant="outline" disabled={preparing} onClick={() => onChoose(provider.value)}>
                  <CloudProviderIcon provider={provider.value} />
                  {provider.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Storage can move later from Settings. STL Quest copies and verifies every file before switching, and leaves the original untouched.
      </p>
    </div>
  )
}
