import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { StorageConfig } from '../../../core/types'
import { S3_PROVIDER_DOCS, S3_PROVIDERS, type S3Provider } from '../../storageProviders'
import { useI18n } from '../../i18n'
import { s3RegionForProviderChange, type StorageConfigFormApi } from '../../storageForm'
import { StorageProviderIcon } from '../StorageProviderIcon'

export function S3StorageFields({ form, current }: { form: StorageConfigFormApi; current?: Extract<StorageConfig, { adapter: 's3' }> }) {
  const t = useI18n().t.storage.s3
  const providers = S3_PROVIDERS.map((value) => ({ value, label: t.providers[value] }))
  return (
    <>
      <form.Field name="provider">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="storage-provider">{t.provider}</FieldLabel>
            <Select
              items={providers}
              value={field.state.value}
              onValueChange={(provider) => {
                const next = provider as S3Provider
                field.handleChange(next)
                const region = s3RegionForProviderChange(next, form.getFieldValue('region'))
                if (region) form.setFieldValue('region', region)
              }}
            >
              <SelectTrigger className="w-full" id="storage-provider">
                <SelectValue>
                  <StorageProviderIcon provider={field.state.value} />
                  <span>{t.providers[field.state.value]}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} className="min-w-64">
                {providers.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    <StorageProviderIcon provider={provider.value} />
                    <span>{provider.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.provider}>
        {(provider) => (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            <p>{t.help[provider].description}</p>
            <a
              className="mt-1 inline-block font-medium text-foreground underline underline-offset-3"
              href={S3_PROVIDER_DOCS[provider]}
              target="_blank"
              rel="noreferrer"
            >
              {t.setupGuide}
            </a>
          </div>
        )}
      </form.Subscribe>
      <form.Subscribe selector={(state) => state.values.provider}>
        {(provider) =>
          provider === 'cloudflare' ? (
            <form.Field name="accountId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="storage-account-id">{t.accountId}</FieldLabel>
                  <Input
                    id="storage-account-id"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                  />
                </Field>
              )}
            </form.Field>
          ) : provider === 'custom' ? (
            <form.Field name="endpoint">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="storage-endpoint">{t.endpoint}</FieldLabel>
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
          ) : null
        }
      </form.Subscribe>
      <FieldSet>
        <FieldLegend>{t.bucket}</FieldLegend>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <form.Field name="bucket">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="storage-bucket">{t.bucketName}</FieldLabel>
                <Input
                  id="storage-bucket"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="stlquest-models"
                  required
                />
              </Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.provider}>
            {(provider) =>
              provider !== 'cloudflare' && provider !== 'google-cloud' ? (
                <form.Field name="region">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="storage-region">{t.region}</FieldLabel>
                      <Input
                        id="storage-region"
                        value={field.state.value}
                        onChange={(event) => field.handleChange(event.target.value)}
                        required
                      />
                      <FieldDescription>{t.regionDescription}</FieldDescription>
                    </Field>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>
        </div>
        <form.Field name="prefix">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="storage-prefix">{t.prefix}</FieldLabel>
              <Input
                id="storage-prefix"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="stlquest"
              />
              <FieldDescription>{t.prefixDescription}</FieldDescription>
            </Field>
          )}
        </form.Field>
      </FieldSet>
      <FieldSet>
        <FieldLegend>{t.accessKeys}</FieldLegend>
        <FieldDescription>{t.accessKeysDescription}</FieldDescription>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <form.Field name="accessKeyId">
            {(field) => (
              <Field>
                <form.Subscribe selector={(state) => state.values.provider}>
                  {(provider) => <FieldLabel htmlFor="storage-access">{t.help[provider].accessKey}</FieldLabel>}
                </form.Subscribe>
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
                <form.Subscribe selector={(state) => state.values.provider}>
                  {(provider) => <FieldLabel htmlFor="storage-secret">{t.help[provider].secretKey}</FieldLabel>}
                </form.Subscribe>
                <Input
                  id="storage-secret"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={current ? t.keepSecret : ''}
                  autoComplete="off"
                  required={!current}
                />
              </Field>
            )}
          </form.Field>
        </div>
      </FieldSet>
      <form.Subscribe selector={(state) => state.values.provider}>
        {(provider) =>
          provider === 'custom' ? (
            <form.Field name="forcePathStyle">
              {(field) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="storage-path-style">{t.pathStyle}</FieldLabel>
                    <FieldDescription>{t.pathStyleDescription}</FieldDescription>
                  </FieldContent>
                  <Switch id="storage-path-style" checked={field.state.value} onCheckedChange={field.handleChange} />
                </Field>
              )}
            </form.Field>
          ) : null
        }
      </form.Subscribe>
    </>
  )
}
