import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repository } from '../core/types'
import { cloudStorageConnection, setCloudStorageConnection, workspaceCloudStorage } from './cloudStorage'
import { beginOneDriveAuthorization, completeOneDriveAuthorization } from './oneDriveConnection'

describe('OneDrive connection', () => {
  let dataDirectory: string
  let previousDataDirectory: string | undefined
  let workspace: Repository
  const app = { clientId: 'client-id', clientSecret: 'client-secret' }

  beforeEach(() => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-onedrive-connection-'))
    previousDataDirectory = process.env.DATA_DIR
    process.env.DATA_DIR = dataDirectory
    const settings = new Map<string, unknown>()
    workspace = {
      getSetting: <T>(key: string) => settings.get(key) as T | undefined,
      setSetting: (key: string, value: unknown) => settings.set(key, value),
    } as unknown as Repository
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  it('stores an offline connection after verifying Graph access', async () => {
    let folderCreated = false
    let uploaded = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
        if (url.includes('/oauth2/v2.0/token'))
          return init?.body instanceof URLSearchParams && init.body.get('code')
            ? Response.json({ access_token: 'oauth-access', refresh_token: 'refresh-token' })
            : Response.json({ access_token: 'graph-access', expires_in: 3_600 })
        if (url.includes('/v1.0/me?$select='))
          return Response.json({ id: 'account-id', displayName: 'Print Owner', mail: 'owner@example.com' })
        if (url.endsWith('/special/approot')) return Response.json({ id: 'root-id', name: 'STL Quest', folder: {} })
        if (url.includes(':/content')) {
          if (init?.method === 'PUT') {
            uploaded = true
            return Response.json({ id: 'probe-id', name: 'health', size: 1 })
          }
          return new Response('x')
        }
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        if (url.endsWith('/children')) {
          folderCreated = true
          return Response.json({ id: 'stlquest-id', name: '.stlquest', folder: {} })
        }
        if (url.includes('items/root-id:/.stlquest'))
          return folderCreated
            ? Response.json({ id: 'stlquest-id', name: '.stlquest', folder: {} })
            : Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })
        return uploaded
          ? Response.json({ id: 'probe-id', name: 'health', size: 1 })
          : Response.json({ error: { code: 'itemNotFound' } }, { status: 404 })
      }),
    )
    const authorization = new URL(
      await beginOneDriveAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage'),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeOneDriveAuthorization(
        app,
        workspace,
        new Request(`https://print.example.com/api/storage/onedrive/callback?code=code&state=${state}`),
        'admin-id',
      ),
    ).resolves.toBe('/settings/storage')

    expect(await cloudStorageConnection(workspace, 'onedrive')).toMatchObject({
      refreshToken: 'refresh-token',
      accountEmail: 'owner@example.com',
    })
    expect(authorization.searchParams.get('scope')).toContain('Files.ReadWrite')
  })

  it('keeps an active connection usable while reauthorization is pending', async () => {
    await setCloudStorageConnection(workspace, 'onedrive', { refreshToken: 'current-token' })

    await beginOneDriveAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage')

    expect(await workspaceCloudStorage(workspace)).toMatchObject({
      connections: { onedrive: { refreshToken: 'current-token' } },
      pending: { provider: 'onedrive', adminId: 'admin-id' },
    })
  })
})
