import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportBinaryStl } from '../core/mesh/stl'

function cookies(headers: Headers) {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

function metadata(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',')
}

describe('tus upload transport', () => {
  let temporary: string | undefined

  afterEach(async () => {
    delete process.env.DATA_DIR
    const singleton = globalThis as typeof globalThis & { __printhub?: Promise<{ repository: { close(): void } }> }
    const running = singleton.__printhub
    delete singleton.__printhub
    if (running) (await running.catch(() => undefined))?.repository.close()
    vi.resetModules()
    if (temporary) await fs.promises.rm(temporary, { recursive: true, force: true })
  })

  it('creates, completes, and safely resumes an authenticated upload', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))

    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'probe.stl', name: 'Probe', quantity: '1', requesterName: 'Owner' }),
        },
      }),
    )
    expect(created.status).toBe(201)
    const location = created.headers.get('location')
    expect(location).toMatch(/^\/api\/upload\//)

    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )
    expect(completed.status).toBe(204)
    expect(completed.headers.get('x-request-id')).toBeTruthy()
    expect(instance.repository.listRequests()).toMatchObject([{ name: 'Probe', fileName: 'probe.stl' }])
    await instance.assetQueue.idle()

    const resumed = await handleUpload(new Request(`http://print.test${location}`, { method: 'HEAD', headers }))
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('upload-offset')).toBe(String(bytes.length))
    expect(instance.repository.listRequests()).toHaveLength(1)
  })

  it('stores an assigned printer without duplicating its print type', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-mixed-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { SqliteRepository } = await import('../adapters/sqlite')
    const repository = SqliteRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: prints })
    repository.setSetting('plate-planner-profiles', [
      {
        id: 'resin-printer',
        name: 'Resin printer',
        printType: 'resin',
        enabled: true,
        widthMm: 100,
        depthMm: 60,
        heightMm: 150,
        spacingMm: 2,
        supportMarginMm: 2,
        adhesionMarginMm: 1,
        heightAllowanceMm: 4,
        maxHeightDifferenceMm: 20,
      },
      {
        id: 'filament-printer',
        name: 'Filament printer',
        printType: 'filament',
        enabled: true,
        widthMm: 220,
        depthMm: 220,
        heightMm: 250,
        spacingMm: 3,
        brimMarginMm: 2,
        filamentDiameterMm: 1.75,
        materialDensityGPerCm3: 1.24,
      },
    ])
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'owner@example.com', password: 'password1234', name: 'Owner' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'filament.stl', name: 'Filament model', quantity: '1', printerId: 'filament-printer' }),
        },
      }),
    )
    const location = created.headers.get('location')
    expect(location).toBeTruthy()

    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )

    expect(completed.status).toBe(204)
    expect(instance.repository.listRequests()).toMatchObject([
      { name: 'Filament model', requestedPrintType: undefined, printerId: 'filament-printer' },
    ])
    await instance.assetQueue.idle()
  })
})
