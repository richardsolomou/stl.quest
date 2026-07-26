import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repository } from '../core/types'

describe('workspace cloud storage', () => {
  let temporary: string
  let previousDataDirectory: string | undefined
  let previousKey: string | undefined

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stlquest-cloud-storage-'))
    previousDataDirectory = process.env.DATA_DIR
    previousKey = process.env.INTEGRATIONS_ENCRYPTION_KEY
    process.env.DATA_DIR = temporary
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32).toString('base64url')
  })

  afterEach(() => {
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    if (previousKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY
    else process.env.INTEGRATIONS_ENCRYPTION_KEY = previousKey
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  const settingStore = () => {
    const settings = new Map<string, unknown>()
    return {
      getSetting: async <T>(key: string) => settings.get(key) as T | undefined,
      setSetting: async (key: string, value: unknown) => void settings.set(key, value),
    } as unknown as Repository
  }

  it('keeps one workspace connection out of another', async () => {
    const { cloudStorageConnection, setCloudStorageConnection } = await import('./cloudStorage')
    const first = settingStore()
    const second = settingStore()

    await setCloudStorageConnection(first, 'dropbox', { refreshToken: 'first-token' })

    expect(await cloudStorageConnection(first, 'dropbox')).toMatchObject({ refreshToken: 'first-token' })
    expect(await cloudStorageConnection(second, 'dropbox')).toBeUndefined()
  })

  it('encrypts the stored refresh token', async () => {
    const { setCloudStorageConnection, CLOUD_STORAGE_SETTING } = await import('./cloudStorage')
    const workspace = settingStore()

    await setCloudStorageConnection(workspace, 'onedrive', { refreshToken: 'secret-token' })

    expect(JSON.stringify(await workspace.getSetting(CLOUD_STORAGE_SETTING))).not.toContain('secret-token')
  })

  it('leaves other providers alone when one is disconnected', async () => {
    const { cloudStorageConnection, setCloudStorageConnection } = await import('./cloudStorage')
    const workspace = settingStore()
    await setCloudStorageConnection(workspace, 'dropbox', { refreshToken: 'dropbox-token' })
    await setCloudStorageConnection(workspace, 'google-drive', { refreshToken: 'drive-token' })

    await setCloudStorageConnection(workspace, 'dropbox', undefined)

    expect(await cloudStorageConnection(workspace, 'dropbox')).toBeUndefined()
    expect(await cloudStorageConnection(workspace, 'google-drive')).toMatchObject({ refreshToken: 'drive-token' })
  })

  it('hands a deployment-wide connection to the workspace already storing models in it', async () => {
    const { DrizzleRepository } = await import('../db/repository')
    const { adoptDeploymentCloudConnections, cloudStorageConnection, cloudStorageApp } = await import('./cloudStorage')
    const { deploymentSettings } = await import('./app')
    const { setStoredIntegrationConfig, getStoredIntegrationConfig, encryptSetting } = await import('./integrations')
    const { organization } = await import('../db/schema')
    const repository = await DrizzleRepository.open(path.join(temporary, 'stlquest.sqlite'))
    try {
      await repository.database
        .insert(organization)
        .values({ id: 'test-workspace', name: 'Test workspace', slug: 'test-workspace', createdAt: new Date() })
        .onConflictDoNothing()
        .run()
      const deployment = deploymentSettings(repository)
      await setStoredIntegrationConfig(deployment, {
        passwordEnabled: true,
        dropbox: { clientId: 'app-key', clientSecret: 'app-secret', refreshToken: 'shared-token', accountEmail: 'owner@example.com' },
      } as never)
      const scoped = await repository.scoped('test-workspace')
      await scoped.setSetting('storageEncrypted', encryptSetting({ adapter: 'dropbox', root: '' }))

      await adoptDeploymentCloudConnections(repository)

      expect(await cloudStorageConnection(scoped, 'dropbox')).toMatchObject({
        refreshToken: 'shared-token',
        accountEmail: 'owner@example.com',
      })
      expect(await cloudStorageApp(deployment, 'dropbox')).toEqual({ clientId: 'app-key', clientSecret: 'app-secret' })
      expect(JSON.stringify(await getStoredIntegrationConfig(deployment))).not.toContain('shared-token')
    } finally {
      await repository.close()
    }
  })
})
