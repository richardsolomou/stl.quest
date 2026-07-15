import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repository } from '../core/types'
import { getGoogleDriveConnection, setStoredIntegrationConfig } from './integrations'
import { beginGoogleDriveAuthorization, completeGoogleDriveAuthorization } from './googleDriveConnection'

describe('Google Drive connection', () => {
  let dataDirectory: string
  let previousDataDirectory: string | undefined
  let repository: Repository

  beforeEach(() => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-google-drive-connection-'))
    previousDataDirectory = process.env.DATA_DIR
    process.env.DATA_DIR = dataDirectory
    const settings = new Map<string, unknown>()
    repository = {
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

  it('stores an offline connection after verifying Drive access', async () => {
    let uploaded = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
        if (url === 'https://oauth2.googleapis.com/token')
          return init?.body instanceof URLSearchParams && init.body.get('code')
            ? Response.json({ access_token: 'oauth-access', refresh_token: 'refresh-token' })
            : Response.json({ access_token: 'drive-access', expires_in: 3_600 })
        if (url.startsWith('https://openidconnect.googleapis.com/'))
          return Response.json({ sub: 'account-id', email: 'owner@example.com', name: 'Print Owner' })
        if (url.includes('alt=media')) return new Response('x')
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        if (url.startsWith('https://www.googleapis.com/upload/')) {
          uploaded = true
          return Response.json({ id: 'probe-id', size: '1' })
        }
        const query = new URL(url).searchParams.get('q') ?? ''
        if (query.includes('printhubRoot'))
          return Response.json({ files: [{ id: 'root-id', name: 'PrintHub', mimeType: 'application/vnd.google-apps.folder' }] })
        return Response.json({
          files: uploaded ? [{ id: 'probe-id', name: 'health', mimeType: 'application/octet-stream', size: '1' }] : [],
        })
      }),
    )
    const authorization = new URL(
      beginGoogleDriveAuthorization(
        repository,
        { clientId: 'client-id', clientSecret: 'client-secret' },
        'admin-id',
        'https://print.example.com',
        '/settings/storage',
      ),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeGoogleDriveAuthorization(
        repository,
        new Request(`https://print.example.com/api/storage/google-drive/callback?code=code&state=${state}`),
        'admin-id',
      ),
    ).resolves.toBe('/settings/storage')

    expect(getGoogleDriveConnection(repository)).toMatchObject({ refreshToken: 'refresh-token', accountEmail: 'owner@example.com' })
    expect(authorization.searchParams.get('scope')).toContain('drive.file')
  })

  it('keeps an active connection usable while reauthorization is pending', () => {
    setStoredIntegrationConfig(repository, {
      passwordEnabled: true,
      googleDrive: { clientId: 'current-id', clientSecret: 'current-secret', refreshToken: 'current-token' },
    })

    beginGoogleDriveAuthorization(
      repository,
      { clientId: 'replacement-id', clientSecret: 'replacement-secret' },
      'admin-id',
      'https://print.example.com',
      '/settings/storage',
    )

    expect(getGoogleDriveConnection(repository)).toMatchObject({
      clientId: 'current-id',
      clientSecret: 'current-secret',
      refreshToken: 'current-token',
      pending: { clientId: 'replacement-id', clientSecret: 'replacement-secret' },
    })
  })
})
