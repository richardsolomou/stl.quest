import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: vi.fn(),
  beginDropbox: vi.fn(),
  completeDropbox: vi.fn(),
  completeGoogleDrive: vi.fn(),
  completeOneDrive: vi.fn(),
  deploymentSettings: vi.fn(() => ({})),
  requireCloudStorageApp: vi.fn(),
}))

vi.mock('./app', () => ({ app: mocks.app, deploymentSettings: mocks.deploymentSettings }))
vi.mock('./cloudStorage', () => ({ requireCloudStorageApp: mocks.requireCloudStorageApp }))
vi.mock('./dropboxConnection', () => ({
  beginDropboxAuthorization: mocks.beginDropbox,
  completeDropboxAuthorization: mocks.completeDropbox,
}))
vi.mock('./googleDriveConnection', () => ({
  beginGoogleDriveAuthorization: vi.fn(),
  completeGoogleDriveAuthorization: mocks.completeGoogleDrive,
}))
vi.mock('./oneDriveConnection', () => ({
  beginOneDriveAuthorization: vi.fn(),
  completeOneDriveAuthorization: mocks.completeOneDrive,
}))

import { CloudPermissionError } from './cloudConnectionState'
import { beginCloudStorageAuthorization, cloudStorageAuthorizationCallback } from './cloudConnections'

describe('cloud connections', () => {
  const capture = vi.fn()
  const cloudApp = { clientId: 'client-id', clientSecret: 'client-secret' }
  const repository = { getSetting: vi.fn(), setSetting: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCloudStorageApp.mockResolvedValue(cloudApp)
    mocks.app.mockResolvedValue({
      requireIdentity: vi.fn().mockResolvedValue({ id: 'admin-id', role: 'user' }),
      workspace: vi.fn().mockResolvedValue({ identity: { workspaceRole: 'owner' }, repository }),
      repository,
      telemetry: { capture },
    })
  })

  it('dispatches authorization setup to the selected provider', async () => {
    mocks.beginDropbox.mockResolvedValue('https://www.dropbox.com/oauth2/authorize')

    await beginCloudStorageAuthorization('dropbox', cloudApp, repository, 'admin-id', 'https://print.example.com', '/settings/storage')

    expect(mocks.beginDropbox).toHaveBeenCalledWith(cloudApp, repository, 'admin-id', 'https://print.example.com', '/settings/storage')
  })

  it('redirects successful callbacks to the initiating page', async () => {
    mocks.completeGoogleDrive.mockResolvedValue('/settings/storage')

    const response = await cloudStorageAuthorizationCallback(
      new Request('https://print.example.com/api/storage/google-drive/callback?code=code&state=state'),
      'google-drive',
    )

    expect(response.headers.get('location')).toBe('https://print.example.com/settings/storage?cloud=google-drive&outcome=connected')
  })

  it('reports provider permission failures in the redirect', async () => {
    mocks.completeOneDrive.mockRejectedValue(new CloudPermissionError('/settings/storage', 'missing permissions'))

    const response = await cloudStorageAuthorizationCallback(
      new Request('https://print.example.com/api/storage/onedrive/callback?code=code&state=state'),
      'onedrive',
    )

    expect(response.headers.get('location')).toBe('https://print.example.com/settings/storage?cloud=onedrive&outcome=missing-permissions')
  })

  it('redirects under the base path', async () => {
    vi.stubEnv('BASE_PATH', '/stlquest')
    mocks.completeGoogleDrive.mockResolvedValue('/settings/storage')

    const response = await cloudStorageAuthorizationCallback(
      new Request('https://print.example.com/stlquest/api/storage/google-drive/callback?code=code&state=state'),
      'google-drive',
    )
    vi.unstubAllEnvs()

    expect(response.headers.get('location')).toBe(
      'https://print.example.com/stlquest/settings/storage?cloud=google-drive&outcome=connected',
    )
  })

  it('redirects to the public https origin behind a TLS proxy', async () => {
    mocks.completeGoogleDrive.mockResolvedValue('/settings/storage')

    const response = await cloudStorageAuthorizationCallback(
      new Request('http://stlquest:3000/api/storage/google-drive/callback?code=code&state=state', {
        headers: { 'x-forwarded-host': 'print.example.com', 'x-forwarded-proto': 'https' },
      }),
      'google-drive',
    )

    expect(response.headers.get('location')).toBe('https://print.example.com/settings/storage?cloud=google-drive&outcome=connected')
  })
})
