import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repository } from '../core/types'
import { cloudStorageConnection, setCloudStorageConnection, workspaceCloudStorage } from './cloudStorage'
import type { SettingStore } from './integrations'
import {
  beginDropboxAuthorization,
  completeDropboxAuthorization,
  DropboxPermissionError,
  publicDropboxConnection,
} from './dropboxConnection'

describe('Dropbox connection', () => {
  let dataDirectory: string
  let previousDataDirectory: string | undefined
  let workspace: Repository
  const app = { clientId: 'app-key', clientSecret: 'app-secret' }

  beforeEach(() => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-dropbox-connection-'))
    previousDataDirectory = process.env.DATA_DIR
    process.env.DATA_DIR = dataDirectory
    const settings = new Map<string, unknown>()
    workspace = {
      getSetting: async <T>(key: string) => (await settings.get(key)) as T | undefined,
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
        .mockResolvedValueOnce(new Response('STL Quest'))
        .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'file' } }))
        .mockResolvedValueOnce(Response.json({ metadata: { '.tag': 'file' } })),
    )
    const authorization = new URL(
      await beginDropboxAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage'),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeDropboxAuthorization(
        app,
        workspace,
        new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
        'admin-id',
      ),
    ).resolves.toBe('/settings/storage')

    expect(await cloudStorageConnection(workspace, 'dropbox')).toMatchObject({
      refreshToken: 'refresh-token',
      accountName: 'Print Owner',
      accountEmail: 'owner@example.com',
    })
    const deployment = { getSetting: async () => undefined, setSetting: async () => undefined } satisfies SettingStore
    expect(await publicDropboxConnection(deployment, workspace)).toMatchObject({
      available: false,
      connected: true,
      accountName: 'Print Owner',
    })
    expect(JSON.stringify(await workspace.getSetting('cloudStorageEncrypted'))).not.toContain('refresh-token')
  })

  it('rejects callbacks that do not match the initiating admin and state', async () => {
    const authorization = new URL(
      await beginDropboxAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage'),
    )
    const state = authorization.searchParams.get('state')!

    await expect(
      completeDropboxAuthorization(
        app,
        workspace,
        new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
        'different-admin',
      ),
    ).rejects.toBeInstanceOf(Response)
  })

  it('keeps an active connection usable while reauthorization is pending', async () => {
    await setCloudStorageConnection(workspace, 'dropbox', { refreshToken: 'current-token' })

    await beginDropboxAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage')

    expect(await workspaceCloudStorage(workspace)).toMatchObject({
      connections: { dropbox: { refreshToken: 'current-token' } },
      pending: { provider: 'dropbox', adminId: 'admin-id' },
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
      await beginDropboxAuthorization(app, workspace, 'admin-id', 'https://print.example.com', '/settings/storage'),
    )
    const state = authorization.searchParams.get('state')!

    const error = await completeDropboxAuthorization(
      app,
      workspace,
      new Request(`https://print.example.com/api/storage/dropbox/callback?code=authorization-code&state=${state}`),
      'admin-id',
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(DropboxPermissionError)
    expect(error).toMatchObject({ missingScopes: ['files.content.write'], returnTo: '/settings/storage' })
    expect(await cloudStorageConnection(workspace, 'dropbox')).toBeUndefined()
  })
})
