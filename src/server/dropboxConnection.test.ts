import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repository } from '../core/types'
import { getDropboxConnection, setStoredIntegrationConfig } from './integrations'
import {
  beginDropboxAuthorization,
  completeDropboxAuthorization,
  DropboxPermissionError,
  publicDropboxConnection,
} from './dropboxConnection'

describe('Dropbox connection', () => {
  let dataDirectory: string
  let previousDataDirectory: string | undefined
  let repository: Repository

  beforeEach(() => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'printhub-dropbox-connection-'))
    previousDataDirectory = process.env.DATA_DIR
    process.env.DATA_DIR = dataDirectory
    const settings = new Map<string, unknown>()
    repository = {
      getSetting: <T>(key: string) => settings.get(key) as T | undefined,
      setSetting: (key: string, value: unknown) => {
        settings.set(key, value)
      },
    } as unknown as Repository
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    fs.rmSync(dataDirectory, { recursive: true, force: true })
  })

  it('stores OAuth credentials encrypted and completes an offline connection', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', account_id: 'account-id' }))
        .mockResolvedValueOnce(
          Response.json({ account_id: 'account-id', email: 'owner@example.com', name: { display_name: 'Print Owner' } }),
        )
        .mockResolvedValueOnce(Response.json({ error_summary: 'path/not_found/' }, { status: 409 }))
        .mockResolvedValueOnce(Response.json({ '.tag': 'file' }))
        .mockResolvedValueOnce(new Response('PrintHub'))
        .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'file' } }))
        .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'file' } })),
    )
    const authorization = new URL(
      beginDropboxAuthorization(
        repository,
        { clientId: 'app-key', clientSecret: 'app-secret' },
        'admin-id',
        'https://print.example.com',
        '/settings/storage',
      ),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeDropboxAuthorization(
        repository,
        new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
        'admin-id',
      ),
    ).resolves.toBe('/settings/storage')

    expect(getDropboxConnection(repository)).toMatchObject({
      clientId: 'app-key',
      clientSecret: 'app-secret',
      refreshToken: 'refresh-token',
      accountName: 'Print Owner',
      accountEmail: 'owner@example.com',
    })
    expect(publicDropboxConnection(repository, 'https://print.example.com')).toMatchObject({
      configured: true,
      connected: true,
      clientId: 'app-key',
      secretConfigured: true,
      accountName: 'Print Owner',
    })
    expect(JSON.stringify(repository.getSetting('integrations'))).not.toContain('refresh-token')
  })

  it('rejects callbacks that do not match the initiating admin and state', async () => {
    const authorization = new URL(
      beginDropboxAuthorization(
        repository,
        { clientId: 'app-key', clientSecret: 'app-secret' },
        'admin-id',
        'https://print.example.com',
        '/settings/storage',
      ),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeDropboxAuthorization(
        repository,
        new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
        'different-admin',
      ),
    ).rejects.toBeInstanceOf(Response)
  })

  it('keeps an active connection usable while reauthorization is pending', () => {
    setStoredIntegrationConfig(repository, {
      passwordEnabled: true,
      dropbox: { clientId: 'current-key', clientSecret: 'current-secret', refreshToken: 'current-token' },
    })

    beginDropboxAuthorization(
      repository,
      { clientId: 'replacement-key', clientSecret: 'replacement-secret' },
      'admin-id',
      'https://print.example.com',
      '/settings/storage',
    )

    expect(getDropboxConnection(repository)).toMatchObject({
      clientId: 'current-key',
      clientSecret: 'current-secret',
      refreshToken: 'current-token',
      pending: { clientId: 'replacement-key', clientSecret: 'replacement-secret' },
    })
  })

  it('rejects connections missing required Dropbox scopes before storing the refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ access_token: 'access-token', refresh_token: 'refresh-token', account_id: 'account-id' }))
        .mockResolvedValueOnce(Response.json({ account_id: 'account-id' }))
        .mockResolvedValueOnce(Response.json({ error_summary: 'path/not_found/' }, { status: 409 }))
        .mockResolvedValueOnce(
          Response.json(
            {
              error_summary: 'missing_scope/',
              error: {
                '.tag': 'missing_scope',
                required_scope: 'files.content.write',
              },
              user_message: {
                text: "Your app does not have the required scope 'files.content.write'.",
              },
            },
            { status: 400 },
          ),
        )
        .mockResolvedValue(Response.json({ metadata: { '.tag': 'file' } })),
    )
    const authorization = new URL(
      beginDropboxAuthorization(
        repository,
        { clientId: 'app-key', clientSecret: 'app-secret' },
        'admin-id',
        'https://print.example.com',
        '/settings/storage',
      ),
    )
    const state = authorization.searchParams.get('state')!

    const error = await completeDropboxAuthorization(
      repository,
      new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
      'admin-id',
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(DropboxPermissionError)
    expect(error).toMatchObject({ missingScopes: ['files.content.write'], returnTo: '/settings/storage' })
    expect(getDropboxConnection(repository)?.refreshToken).toBeUndefined()
  })
})
