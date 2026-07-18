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
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
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
          'upload-metadata': metadata({
            filename: 'probe.stl',
            name: 'Probe',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
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
    expect(instance.repository.listRequests()).toMatchObject([
      { name: 'Probe', fileName: 'probe.stl', ownerEmail: 'owner@example.com', ownerName: 'Owner' },
    ])
    await (await instance.workspace(new Headers(headers))).assetQueue.idle()

    const resumed = await handleUpload(new Request(`http://print.test${location}`, { method: 'HEAD', headers }))
    expect(resumed.status).toBe(200)
    expect(resumed.headers.get('upload-offset')).toBe(String(bytes.length))
    expect(instance.repository.listRequests()).toHaveLength(1)
  })

  it('rejects an in-flight upload after the active workspace changes', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-workspace-switch-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'primary-prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const signup = await instance.auth.api.signUpEmail({
      body: { email: 'switcher@example.com', password: 'password1234', name: 'Switcher' },
      returnHeaders: true,
    })
    const headers = {
      cookie: cookies(signup.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const primary = await instance.workspace(new Headers(headers))
    const secondary = instance.repository.createWorkspace(primary.identity, 'Secondary farm')
    instance.repository.scoped(secondary.id).setSetting('storage', { adapter: 'local', root: path.join(temporary, 'secondary-prints') })
    const { handleUpload } = await import('./uploads')
    const bytes = exportBinaryStl(new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), new Uint32Array([0, 1, 2]))
    const created = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...headers,
          'upload-length': String(bytes.length),
          'upload-metadata': metadata({ filename: 'switch.stl', name: 'Switch model', quantity: '1', requestedPrintType: 'resin' }),
        },
      }),
    )
    const location = created.headers.get('location')
    expect(location).toBeTruthy()

    await instance.setActiveWorkspace(secondary.id, new Headers(headers))
    const completed = await handleUpload(
      new Request(`http://print.test${location}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/offset+octet-stream', 'upload-offset': '0' },
        body: Buffer.from(bytes),
      }),
    )

    expect(completed.status).toBe(409)
    expect(primary.repository.listRequests()).toHaveLength(0)
    expect(instance.repository.scoped(secondary.id).listRequests()).toHaveLength(0)
  })

  it('stores the requested print type without accepting a printer assignment', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-mixed-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const prints = path.join(temporary, 'prints')
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
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
          'upload-metadata': metadata({
            filename: 'filament.stl',
            name: 'Filament model',
            quantity: '1',
            requestedPrintType: 'filament',
            printerId: 'filament-printer',
          }),
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
      { name: 'Filament model', requestedPrintType: 'filament', printerId: undefined },
    ])
    await (await instance.workspace(new Headers(headers))).assetQueue.idle()
  })

  it('removes incomplete TUS data and metadata when the owner account is deleted', async () => {
    temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'printhub-tus-delete-'))
    process.env.DATA_DIR = path.join(temporary, 'data')
    const { DrizzleRepository } = await import('../db/repository')
    const repository = DrizzleRepository.open(path.join(process.env.DATA_DIR, 'printhub.sqlite'))
    repository.setSetting('storage', { adapter: 'local', root: path.join(temporary, 'prints') })
    repository.close()

    const { app } = await import('./app')
    const instance = await app()
    const adminSignup = await instance.auth.api.signUpEmail({
      body: { email: 'admin@example.com', password: 'password1234', name: 'Admin' },
      returnHeaders: true,
    })
    const adminHeaders = new Headers({ cookie: cookies(adminSignup.headers) })
    const { withAuthProvisioning } = await import('./authInvite')
    const created = await withAuthProvisioning(() =>
      instance.auth.api.createUser({
        body: { email: 'owner@example.com', password: 'password1234', name: 'Owner', role: 'requester' },
        headers: adminHeaders,
      }),
    )
    const ownerSignin = await instance.auth.api.signInEmail({
      body: { email: 'owner@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    const uploadHeaders = {
      cookie: cookies(ownerSignin.headers),
      origin: 'http://print.test',
      'sec-fetch-site': 'same-origin',
      'tus-resumable': '1.0.0',
    }
    const { handleUpload } = await import('./uploads')
    const createdUpload = await handleUpload(
      new Request('http://print.test/api/upload', {
        method: 'POST',
        headers: {
          ...uploadHeaders,
          'upload-length': '1024',
          'upload-metadata': metadata({
            filename: 'partial.stl',
            name: 'Partial',
            quantity: '1',
            requestedPrintType: 'resin',
          }),
        },
      }),
    )
    const uploadId = createdUpload.headers.get('location')?.split('/').at(-1)
    expect(uploadId).toBeTruthy()
    const tusDirectory = path.join(process.env.DATA_DIR, 'tus')
    expect((await fs.promises.readdir(tusDirectory)).filter((name) => name.startsWith(uploadId!))).not.toHaveLength(0)

    await instance.auth.api.removeUser({ body: { userId: created.user.id }, headers: adminHeaders })

    expect((await fs.promises.readdir(tusDirectory)).filter((name) => name.startsWith(uploadId!))).toHaveLength(0)
    expect(instance.repository.uploadIdsOwnedBy(created.user.id)).toHaveLength(0)
    expect(instance.repository.listUsers()).not.toContainEqual(expect.objectContaining({ id: created.user.id }))
  })
})
