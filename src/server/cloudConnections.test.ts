import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class PermissionError extends Error {
    constructor(readonly returnTo: string) {
      super('missing permissions')
    }
  }

  return {
    app: vi.fn(),
    beginDropbox: vi.fn(),
    completeDropbox: vi.fn(),
    completeGoogleDrive: vi.fn(),
    completeOneDrive: vi.fn(),
    deploymentSettings: vi.fn(() => ({})),
    PermissionError,
    requireCloudStorageApp: vi.fn(),
  }
})

vi.mock('./app', () => ({ app: mocks.app, deploymentSettings: mocks.deploymentSettings }))
vi.mock('./cloudStorage', () => ({ requireCloudStorageApp: mocks.requireCloudStorageApp }))
vi.mock('./dropboxConnection', () => ({
  beginDropboxAuthorization: mocks.beginDropbox,
  completeDropboxAuthorization: mocks.completeDropbox,
  DropboxPermissionError: mocks.PermissionError,
}))
vi.mock('./googleDriveConnection', () => ({
  beginGoogleDriveAuthorization: vi.fn(),
  completeGoogleDriveAuthorization: mocks.completeGoogleDrive,
  GoogleDrivePermissionError: mocks.PermissionError,
}))
vi.mock('./oneDriveConnection', () => ({
  beginOneDriveAuthorization: vi.fn(),
  completeOneDriveAuthorization: mocks.completeOneDrive,
  OneDrivePermissionError: mocks.PermissionError,
}))

import { beginCloudStorageAuthorization, cloudStorageAuthorizationCallback } from './cloudConnections'

describe('cloud connections', () => {
  const capture = vi.fn(() => Promise.resolve())
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
    mocks.completeOneDrive.mockRejectedValue(new mocks.PermissionError('/settings/storage'))

    const response = await cloudStorageAuthorizationCallback(
      new Request('https://print.example.com/api/storage/onedrive/callback?code=code&state=state'),
      'onedrive',
    )

    expect(response.headers.get('location')).toBe('https://print.example.com/settings/storage?cloud=onedrive&outcome=missing-permissions')
  })
})
