import { ExternalLink } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { StorageConfig } from '../../../core/types'
import { LATEST_DOCUMENTATION_URL } from '../../sourceCode'
import type { StorageConfigFormApi } from '../../storageForm'
import { useI18n } from '../../i18n'

export function WebDAVStorageFields({
  form,
  current,
}: {
  form: StorageConfigFormApi
  current?: Extract<StorageConfig, { adapter: 'webdav' }>
}) {
  const t = useI18n().t.storage.webdav
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>{t.introTitle}</AlertTitle>
        <AlertDescription>
          {t.intro}{' '}
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
            href={`${LATEST_DOCUMENTATION_URL}/webdav.md`}
            target="_blank"
            rel="noreferrer"
          >
            {t.setupLink}
            <ExternalLink className="size-3.5" />
          </a>
        </AlertDescription>
      </Alert>
      <form.Field name="endpoint">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="webdav-endpoint">{t.endpoint}</FieldLabel>
            <Input
              id="webdav-endpoint"
              type="url"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="https://storage.example.com/dav"
              required
            />
            <FieldDescription>{t.endpointDescription}</FieldDescription>
          </Field>
        )}
      </form.Field>
      <form.Field name="root">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="webdav-root">{t.folder}</FieldLabel>
            <Input
              id="webdav-root"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="stlquest"
            />
            <FieldDescription>{t.folderDescription}</FieldDescription>
          </Field>
        )}
      </form.Field>
      <FieldSet>
        <FieldLegend>{t.credentials}</FieldLegend>
        <FieldDescription>{t.credentialsDescription}</FieldDescription>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <form.Field name="username">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="webdav-username">{t.username}</FieldLabel>
                <Input
                  id="webdav-username"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  autoComplete="username"
                  required
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="webdav-password">{t.password}</FieldLabel>
                <Input
                  id="webdav-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={current ? t.keepPassword : ''}
                  autoComplete="current-password"
                  required={!current}
                />
              </Field>
            )}
          </form.Field>
        </div>
      </FieldSet>
    </div>
  )
}
