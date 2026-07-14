import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import type { StorageConfig } from '../../../core/types'
import { updateStorageSettings } from '../../../server/fns'
import { storageQuery } from '../../queries'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const STORAGE_OPTIONS = [
  { value: 'local', label: 'Local folder' },
  { value: 's3', label: 'S3-compatible object storage' },
] as const

export function StoragePane({ onboarding = false, onSaved }: { onboarding?: boolean; onSaved?: () => void } = {}) {
  const { data: current } = useQuery(storageQuery())
  if (!current) return onboarding ? <h3>Choose storage</h3> : <SettingsHeader title="Storage" description="Loading storage settings…" />
  return <StorageForm key={current.adapter} current={current} onboarding={onboarding} onSaved={onSaved} />
}

function StorageForm({ current, onboarding, onSaved }: { current: StorageConfig; onboarding: boolean; onSaved?: () => void }) {
  const callUpdate = useServerFn(updateStorageSettings)
  const queryClient = useQueryClient()
  const s3 = current.adapter === 's3' ? current : undefined
  const form = useForm({
    defaultValues: {
      adapter: current.adapter,
      root: current.adapter === 'local' ? current.root : '/prints',
      endpoint: s3?.endpoint ?? '',
      region: s3?.region ?? 'us-east-1',
      bucket: s3?.bucket ?? '',
      prefix: s3?.prefix ?? '',
      accessKeyId: s3?.accessKeyId ?? '',
      secretAccessKey: '',
      forcePathStyle: s3?.forcePathStyle ?? true,
    },
    onSubmit: async ({ value }) => {
      const config: StorageConfig =
        value.adapter === 'local'
          ? { adapter: 'local', root: value.root }
          : {
              adapter: 's3',
              endpoint: value.endpoint,
              region: value.region,
              bucket: value.bucket,
              prefix: value.prefix || undefined,
              accessKeyId: value.accessKeyId,
              secretAccessKey: value.secretAccessKey,
              forcePathStyle: value.forcePathStyle,
            }
      await callUpdate({ data: config })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['storage'] }),
        queryClient.invalidateQueries({ queryKey: ['session'] }),
      ])
      form.setFieldValue('secretAccessKey', '')
      if (!onboarding) toast.success('Storage settings saved and applied.')
      onSaved?.()
    },
  })

  const formContent = (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      {onboarding && (
        <>
          <h3 className="font-heading text-xl font-semibold">Choose storage</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            PrintHub needs a writable destination before the board is ready. Choose a local folder or S3-compatible storage.
          </p>
        </>
      )}
      <Field>
        <FieldLabel htmlFor="storage-adapter">Adapter</FieldLabel>
        <form.Field name="adapter">
          {(field) => (
            <Select
              items={STORAGE_OPTIONS}
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as StorageConfig['adapter'])}
            >
              <SelectTrigger className="w-full" id="storage-adapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STORAGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      </Field>
      <form.Subscribe selector={(state) => state.values.adapter}>
        {(adapter) =>
          adapter === 'local' ? (
            <Field>
              <FieldLabel htmlFor="storage-root">Folder</FieldLabel>
              <form.Field name="root">
                {(field) => (
                  <Input
                    id="storage-root"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="/prints"
                    required
                  />
                )}
              </form.Field>
            </Field>
          ) : (
            <>
              <form.Field name="endpoint">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-endpoint">Endpoint</FieldLabel>
                    <Input
                      id="storage-endpoint"
                      type="url"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="https://minio.local:9000"
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <div className="flex gap-3 [&>[data-slot=field]]:flex-1">
                <form.Field name="bucket">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="storage-bucket">Bucket</FieldLabel>
                      <Input
                        id="storage-bucket"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        required
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="region">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="storage-region">Region</FieldLabel>
                      <Input id="storage-region" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />
                    </Field>
                  )}
                </form.Field>
              </div>
              <form.Field name="prefix">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-prefix">Key prefix (optional)</FieldLabel>
                    <Input
                      id="storage-prefix"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="printhub"
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="accessKeyId">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-access">Access key ID</FieldLabel>
                    <Input
                      id="storage-access"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      autoComplete="off"
                      required
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="secretAccessKey">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="storage-secret">Secret access key</FieldLabel>
                    <Input
                      id="storage-secret"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={s3 ? 'leave blank to keep current' : ''}
                      autoComplete="off"
                      required={!s3}
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="forcePathStyle">
                {(field) => (
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldLabel htmlFor="storage-path-style">Path-style requests</FieldLabel>
                      <FieldDescription>Required by MinIO and most self-hosted S3 endpoints.</FieldDescription>
                    </FieldContent>
                    <Switch id="storage-path-style" checked={field.state.value} onCheckedChange={field.handleChange} />
                  </Field>
                )}
              </form.Field>
            </>
          )
        }
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) => <FieldError>{error ? String(error) : ''}</FieldError>}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Checking storage…' : onboarding ? 'Finish setup' : 'Save storage settings'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )

  if (onboarding) return formContent

  return (
    <SettingsPage>
      <SettingsHeader
        title="Storage"
        description="Choose where finished print files live. Storage can only be switched while the board is empty; existing files are not migrated."
      />
      <SettingsSection>{formContent}</SettingsSection>
    </SettingsPage>
  )
}
