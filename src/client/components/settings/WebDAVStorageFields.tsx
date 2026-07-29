import { ExternalLink } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { StorageConfig } from '../../../core/types'
import { LATEST_DOCUMENTATION_URL } from '../../sourceCode'
import type { StorageConfigFormApi } from '../../storageForm'

export function WebDAVStorageFields({
  form,
  current,
}: {
  form: StorageConfigFormApi
  current?: Extract<StorageConfig, { adapter: 'webdav' }>
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>A normal folder on hardware you control</AlertTitle>
        <AlertDescription>
          Run a WebDAV server for the folder, then expose it through a stable HTTPS address. Cloudflare Tunnel or Tailscale Funnel can
          provide the encrypted connection without opening a router port. Files remain visible and movable on your machine.{' '}
          <a
            className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
            href={`${LATEST_DOCUMENTATION_URL}/webdav.md`}
            target="_blank"
            rel="noreferrer"
          >
            Set up remote WebDAV
            <ExternalLink className="size-3.5" />
          </a>
        </AlertDescription>
      </Alert>
      <form.Field name="endpoint">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="webdav-endpoint">WebDAV endpoint</FieldLabel>
            <Input
              id="webdav-endpoint"
              type="url"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="https://storage.example.com/dav"
              required
            />
            <FieldDescription>Hosted STL Quest requires HTTPS and must be able to reach this address.</FieldDescription>
          </Field>
        )}
      </form.Field>
      <form.Field name="root">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="webdav-root">Folder</FieldLabel>
            <Input
              id="webdav-root"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="stlquest"
            />
            <FieldDescription>STL Quest adds a private workspace directory below this folder.</FieldDescription>
          </Field>
        )}
      </form.Field>
      <FieldSet>
        <FieldLegend>Credentials</FieldLegend>
        <FieldDescription>Use a login dedicated to STL Quest rather than the account that administers the server.</FieldDescription>
        <div className="flex flex-col gap-3 sm:flex-row [&>[data-slot=field]]:flex-1">
          <form.Field name="username">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="webdav-username">Username</FieldLabel>
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
                <FieldLabel htmlFor="webdav-password">Password</FieldLabel>
                <Input
                  id="webdav-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={current ? 'leave blank to keep current' : ''}
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
