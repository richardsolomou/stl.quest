import type { ReactNode } from 'react'
import { Check, ChevronRight, Cloud, Folder } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { StorageConfig } from '../../../core/types'
import type { StoragePlan } from '../../../core/plans'
import { storageLabel, type CloudProvider, type StorageMessages } from '../../storageProviders'
import { useI18n } from '../../i18n'
import { CloudProviderIcon } from '../CloudProviderIcon'
import { StorageAdapterIcon } from '../StorageAdapterIcon'
import { ManagedStorageUsage, type ManagedStorageUsageValue } from './ManagedStorageUsage'
import { includedStorageOnboardingCopy } from './planCopy'

function storageDescription(
  t: StorageMessages,
  inUse: StorageConfig | undefined,
  settings: boolean,
  serverFolder: string | undefined,
  managedStorage: boolean,
) {
  if (inUse?.adapter === 'managed' && settings) return t.picker.descriptionManagedInUse
  if (inUse && settings) return t.picker.descriptionInUse
  if (inUse) return t.picker.descriptionUnused
  if (serverFolder) return t.picker.descriptionServerFolder
  if (managedStorage) return t.picker.descriptionManaged
  return t.picker.descriptionRemoteRequired
}

export function StorageProviderPicker({
  cloudProviders,
  canSetUpCloud = false,
  serverFolder,
  managedStorage = false,
  managedStorageUnavailableReason,
  managedStorageUsage,
  managedStoragePlan = 'free',
  inUse,
  preparing,
  onUseServerFolder,
  onUseManagedStorage,
  onKeepCurrent,
  currentActionLabel,
  settings = false,
  onChoose,
}: {
  cloudProviders: { value: CloudProvider; label: string; available: boolean }[]
  canSetUpCloud?: boolean
  serverFolder?: string
  managedStorage?: boolean
  managedStorageUnavailableReason?: string
  managedStorageUsage?: ManagedStorageUsageValue
  managedStoragePlan?: StoragePlan
  inUse?: StorageConfig
  preparing: boolean
  onUseServerFolder: () => void
  onUseManagedStorage: () => void
  onKeepCurrent?: () => void
  currentActionLabel?: string
  settings?: boolean
  onChoose: (adapter: StorageConfig['adapter']) => void
}) {
  const { t: messages, locale } = useI18n()
  const t = messages.storage
  const options: { value: StorageConfig['adapter']; label: string; requires: string; icon: ReactNode }[] = [
    ...(inUse && serverFolder
      ? [
          {
            value: 'local' as const,
            label: t.picker.localLabel,
            requires: t.picker.localRequires(serverFolder),
            icon: <StorageAdapterIcon adapter="local" className="size-5" />,
          },
        ]
      : []),
    {
      value: 's3',
      label: t.picker.s3Label,
      requires: t.picker.s3Requires,
      icon: <StorageAdapterIcon adapter="s3" className="size-5" />,
    },
    {
      value: 'webdav',
      label: t.picker.webdavLabel,
      requires: t.picker.webdavRequires,
      icon: <StorageAdapterIcon adapter="webdav" className="size-5" />,
    },
  ]
  const description = storageDescription(t, inUse, settings, serverFolder, managedStorage)
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <h3 className="font-heading text-xl font-semibold">{inUse ? t.picker.changeTitle : t.picker.chooseTitle}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {inUse && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 max-sm:flex-col max-sm:items-stretch sm:p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Check className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.picker.setUp}</span>
              <Badge>{t.picker.inUse}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {inUse.adapter === 'managed' ? (
                t.picker.managedInUse
              ) : (
                <>
                  {t.picker.modelsGoTo.before}
                  <code className="break-all">{storageLabel(inUse, t)}</code>
                  {t.picker.modelsGoTo.after}
                </>
              )}
            </p>
            {inUse.adapter === 'managed' && managedStorageUsage && (
              <ManagedStorageUsage usage={managedStorageUsage} className="mt-3 space-y-2" />
            )}
            {onKeepCurrent && (
              <div className="mt-3">
                <Button type="button" disabled={preparing} onClick={onKeepCurrent}>
                  {currentActionLabel ?? t.picker.keepAndContinue}
                </Button>
              </div>
            )}
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
              <span className="font-medium">{t.picker.serverDisk}</span>
              <Badge>{t.picker.recommended}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t.picker.serverDiskBody.before}
              <code className="break-all">{serverFolder}</code>
              {t.picker.serverDiskBody.after}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
              <Button type="button" disabled={preparing} onClick={onUseServerFolder}>
                {preparing && <Spinner />}
                {preparing ? t.picker.preparing : t.picker.useFolder}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={preparing} onClick={() => onChoose('local')}>
                {t.picker.pickAnother}
              </Button>
            </div>
          </div>
        </div>
      )}
      {(!inUse || inUse.adapter !== 'managed') && managedStorage && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 max-sm:flex-col sm:p-4 max-sm:items-stretch">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Cloud className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.picker.included}</span>
              <Badge>{t.picker.recommended}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {settings ? t.picker.includedSettings : includedStorageOnboardingCopy(managedStoragePlan, messages, locale)}
            </p>
            <div className="mt-3">
              <Button type="button" disabled={preparing} onClick={onUseManagedStorage}>
                {preparing && <Spinner />}
                {preparing ? t.picker.preparing : t.picker.useIncluded}
              </Button>
            </div>
          </div>
        </div>
      )}
      {!inUse && managedStorageUnavailableReason && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {managedStorageUnavailableReason} {t.picker.connectInstead}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {inUse?.adapter === 'managed'
            ? t.picker.ownInstead
            : inUse
              ? t.picker.switchElse
              : managedStorage
                ? t.picker.orOwn
                : serverFolder
                  ? t.picker.orConnect
                  : t.picker.connect}
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
              </span>
              <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{option.requires}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground max-sm:hidden" aria-hidden="true" />
          </button>
        ))}
        {cloudProviders.length > 0 && (
          <div className="rounded-lg border bg-card p-3">
            <span className="font-medium">{t.picker.consumerCloud}</span>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {cloudProviders.every((provider) => provider.available)
                ? t.picker.cloudReady
                : canSetUpCloud
                  ? t.picker.cloudSetUp
                  : t.picker.cloudNeedsApp}
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
      <p className="text-xs leading-relaxed text-muted-foreground">{t.picker.footer}</p>
    </div>
  )
}
