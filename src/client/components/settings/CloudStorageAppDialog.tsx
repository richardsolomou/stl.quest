import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import type { CloudStorageProvider, PublicCloudStorageApp } from '../../../core/auth'
import { removeCloudStorageApp, saveCloudStorageApp } from '../../../server/fns'
import { invalidateQueries } from '../../queryState'
import { CLOUD_PROVIDER_HELP, cloudProviderLabel } from '../../storageProviders'
import { CopyableValue } from '../CopyableValue'
import { DialogProblem } from '../DialogProblem'
import { DialogShell } from '../DialogShell'

// Registering the app is a deployment-wide, one-time job, reachable both from Integrations and from storage setup itself.
export function CloudStorageAppDialog({
  provider,
  current,
  onDone,
}: {
  provider: CloudStorageProvider
  current: PublicCloudStorageApp
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [clientId, setClientId] = useState(current.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const refresh = async () => {
    await invalidateQueries(queryClient, 'integrations', 'cloud-connections')
    onDone()
  }
  const mutation = useMutation({ mutationFn: useServerFn(saveCloudStorageApp), onSuccess: refresh })
  const removeMutation = useMutation({ mutationFn: useServerFn(removeCloudStorageApp), onSuccess: refresh })
  const help = CLOUD_PROVIDER_HELP[provider]
  return (
    <DialogShell open title={`Set up the ${cloudProviderLabel(provider)} app`} className="sm:max-w-[640px]" onClose={onDone}>
      <div className="space-y-5 pr-1">
        <section className="space-y-3 text-sm text-muted-foreground">
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
            href={help.consoleUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open {cloudProviderLabel(provider)} developer console
            <ExternalLink className="size-3.5" />
          </a>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{help.credentials}</li>
            <li>{help.permissions}</li>
            <li>Copy the credentials below. Every workspace then connects its own account from Settings → Storage.</li>
          </ol>
          <CopyableValue label="OAuth redirect URI" value={current.callbackUrl} />
        </section>
        <FieldSet>
          <FieldLegend>App credentials</FieldLegend>
          <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
            <Field>
              <FieldLabel htmlFor="cloud-client-id">{provider === 'dropbox' ? 'App key' : 'Client ID'}</FieldLabel>
              <Input id="cloud-client-id" value={clientId} autoComplete="off" onChange={(event) => setClientId(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cloud-client-secret">{help.secret}</FieldLabel>
              <Input
                id="cloud-client-secret"
                type="password"
                value={clientSecret}
                autoComplete="off"
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder={current.secretConfigured ? 'Leave blank to keep the current secret' : ''}
              />
            </Field>
          </div>
        </FieldSet>
        <DialogProblem
          title={`${cloudProviderLabel(provider)} was not saved`}
          hint={`Check that the credentials match the app in the ${cloudProviderLabel(provider)} console.`}
          error={mutation.error?.message ?? removeMutation.error?.message}
        />
        <div className="flex flex-wrap justify-between gap-2">
          {current.configured ? (
            <Button variant="destructive" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate({ data: { provider } })}>
              {removeMutation.isPending && <Spinner />}
              Remove app
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button
              disabled={!clientId || (!current.secretConfigured && !clientSecret) || mutation.isPending}
              onClick={() => mutation.mutate({ data: { provider, clientId, clientSecret } })}
            >
              {mutation.isPending && <Spinner />}
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  )
}
