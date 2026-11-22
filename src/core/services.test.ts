import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { LocalAssetStore } from '../adapters/filesystem'
import { UploadStaging } from '../adapters/staging'
import { createDatabase } from '../db'
import { DrizzleRepository } from '../db/repository'
import { messagesFor } from './i18n'
import { organization, requests, requestStatuses, user } from '../db/schema'
import type { EventBus, Identity, Notifier, PrinterProfile, Telemetry } from './types'
import { STLQuestService } from './services'
import { consumablePrice, consumablesOfKind, MAX_CONSUMABLES, type Consumable } from './consumables'
import type { Store } from './stores'
import { MAX_EQUIPMENT, type EquipmentItem } from './equipment'
import { PRINTERS_SKIPPED_SETTING } from './printers'
import { summariseSpend } from './spend'
import { DEFAULT_PRICE_CALCULATOR_SETTINGS, PRICE_CALCULATOR_SETTING } from './priceCalculator'
import { requestPrintEstimate } from './printEstimates'
import type { InventoryItems, InventoryKind } from './inventory'
import { seesOnlyOwnRequests } from './visibility'
import { PRINT_TYPE_SETTING } from './printTypes'
import { USAGE_TRACKING_SETTING } from './usageTracking'
import { layeredPlateFile, slicedPlateFile } from '../../e2e/fixtures/slicedPlate'
import { MAX_COVER_BYTES } from './coverImage'
import { readSlicedFile } from './slicedPlate'

const capture = vi.fn(async () => undefined)
const receiveSliced = (service: STLQuestService, report: { runId: string; plate?: number }, file: Uint8Array) =>
  service.receivePrintSlicedFile(report, async (stoppedAt) => readSlicedFile(file, 'print.gcode.3mf', stoppedAt))
const telemetry: Telemetry = { capture, exception: async () => undefined }
const eventBus = (): EventBus => ({ publish: vi.fn() })
const admin: Identity = { id: 'admin', email: 'op@example.com', name: 'Admin', role: 'admin' }
const requester: Identity = { id: 'requester', email: 'owner@example.com', name: 'Owner', role: 'requester' }
const otherRequester: Identity = { id: 'other-requester', email: 'someone-else@example.com', name: 'Someone Else', role: 'requester' }
const slaPrinter: PrinterProfile = {
  id: 'sla-printer',
  name: 'Elegoo Saturn',
  printType: 'resin',
  widthMm: 100,
  depthMm: 100,
}
const largeResinPrinter = { ...slaPrinter, id: 'large-resin-printer', name: 'Large resin printer', widthMm: 200, depthMm: 200 }
const filamentPrinter = {
  id: 'filament-printer',
  name: 'Prusa MK4',
  printType: 'filament',
} satisfies PrinterProfile

describe('STLQuestService crash recovery', () => {
  let root: string
  let data: string
  let repository: DrizzleRepository
  let assets: LocalAssetStore
  let staging: UploadStaging
  let removeTusUpload: Mock<(uploadId: string) => Promise<void>>
  let service: STLQuestService

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-service-'))
    data = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'stlquest-service-data-'))
    repository = await DrizzleRepository.create(createDatabase(':memory:'))
    const now = new Date()
    for (const identity of [admin, requester, otherRequester]) {
      await repository.database
        .insert(user)
        .values({
          id: identity.id,
          name: identity.name,
          email: identity.email,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
          role: 'requester',
        })
        .run()
    }
    assets = new LocalAssetStore(root)
    staging = new UploadStaging(data)
    await Promise.all([assets.initialize(), staging.initialize()])
    removeTusUpload = vi.fn(async () => undefined)
    service = new STLQuestService(repository, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })
  })

  afterEach(async () => {
    await repository.close()
    await Promise.all([fs.promises.rm(root, { recursive: true }), fs.promises.rm(data, { recursive: true })])
  })

  async function stock<Kind extends InventoryKind>(kind: Kind, items: InventoryItems[Kind][]) {
    await repository.changeInventory(kind, (current) => [...current, ...items])
  }

  async function revise<Kind extends InventoryKind>(kind: Kind, item: InventoryItems[Kind]) {
    await repository.changeInventory(kind, (current) => current.map((stored) => (stored.id === item.id ? item : stored)))
  }

  it('publishes membership changes and captures only the assigned role after direct addition', async () => {
    const publish = vi.fn()
    const events: EventBus = { publish }
    const scopedService = new STLQuestService(repository, assets, staging, events, telemetry, { remove: removeTusUpload })
    capture.mockClear()
    await scopedService.addWorkspaceMember({ ...admin, superAdmin: true }, requester.id, 'member')
    expect((await repository.listUsers()).find((account) => account.id === requester.id)?.workspaceRole).toBe('member')
    expect(publish).toHaveBeenCalledWith('user.created')
    expect(capture).toHaveBeenCalledWith(admin.id, 'workspace_member_added', { role: 'member' })
    capture.mockClear()
    await scopedService.addWorkspaceMember({ ...admin, superAdmin: true }, requester.id, 'admin')
    expect(capture).not.toHaveBeenCalled()
    await expect(scopedService.addWorkspaceMember(admin, otherRequester.id, 'member')).rejects.toMatchObject({ status: 403 })
  })

  it('removes access and visibility overrides while preserving the account and its requests', async () => {
    const publish = vi.fn()
    const scopedService = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
    await repository.addWorkspaceMember(requester.id, 'member')
    const requestId = await request()
    await repository.setSetting('board', { memberVisibility: { [requester.id]: 'own', [otherRequester.id]: 'all' } })
    capture.mockClear()
    await scopedService.removeWorkspaceMember({ ...admin, superAdmin: true }, requester.id)
    expect((await repository.listUsers()).some((account) => account.id === requester.id)).toBe(false)
    expect(await repository.accountExists(requester.email)).toBe(true)
    expect(await repository.getRequest(requestId)).toBeDefined()
    expect(await repository.getSetting('board')).toMatchObject({ memberVisibility: { [otherRequester.id]: 'all' } })
    expect(
      (await repository.getSetting<{ memberVisibility: Record<string, string> }>('board'))?.memberVisibility[requester.id],
    ).toBeUndefined()
    expect(publish).toHaveBeenCalledWith('user.created')
    expect(capture).toHaveBeenCalledWith(admin.id, 'workspace_member_removed', {})
    capture.mockClear()
    await scopedService.removeWorkspaceMember({ ...admin, superAdmin: true }, requester.id)
    expect(capture).not.toHaveBeenCalled()
    await expect(scopedService.removeWorkspaceMember(requester, otherRequester.id)).rejects.toMatchObject({ status: 403 })
    await expect(scopedService.removeWorkspaceMember(admin, admin.id)).rejects.toMatchObject({ status: 409 })
  })

  it('lets a workspace admin who is not a super admin remove a member', async () => {
    await repository.addWorkspaceMember(requester.id, 'member')
    await service.removeWorkspaceMember(admin, requester.id)
    expect((await repository.listUsers()).some((account) => account.id === requester.id)).toBe(false)
  })

  it('lets a super admin remove a member regardless of their own workspace role', async () => {
    await repository.addWorkspaceMember(otherRequester.id, 'member')
    await service.removeWorkspaceMember({ ...requester, superAdmin: true }, otherRequester.id)
    expect((await repository.listUsers()).some((account) => account.id === otherRequester.id)).toBe(false)
  })

  it('rejects a direct addition for an unknown account', async () => {
    await expect(service.addWorkspaceMember({ ...admin, superAdmin: true }, 'missing', 'member')).rejects.toMatchObject({ status: 404 })
  })

  async function request() {
    await assets.write('todo/model.stl', new TextEncoder().encode('stl'))
    const id = await repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    return id
  }

  let uploads = 0

  async function upload(requestId: string, fileName: string, contents: string) {
    const uploadId = `staged-upload-${(uploads += 1)}`
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, contents)
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, contents.length)
    return await service.attachModel(uploadId, part, requestId, fileName, requester)
  }

  /** A request that started as a saved link and reached the state a replacement acts on. */
  async function printWithModel(fileName: string) {
    const requestId = await service.createLinkedRequest(
      { name: 'Bracket', quantity: 1, sourceUrl: 'https://makerworld.com/models/bracket', requestedPrintType: 'filament' },
      requester,
    )
    await upload(requestId, fileName, 'stl')
    return requestId
  }

  const readAsset = async (key: string) => await new Response((await assets.read(key)).stream).text()

  it('creates an independent request from an existing print', async () => {
    const id = await request()
    await repository.updateRequest(id, { notes: 'Use grey resin', sourceUrl: 'https://example.com/model' })

    const repeatedId = await service.repeatRequest(id, 5, requester)

    expect(await repository.getRequest(id)).toMatchObject({ quantity: 1, counts: { todo: 1 } })
    expect(await repository.getRequest(repeatedId)).toMatchObject({
      name: 'Model',
      fileName: 'model.stl',
      quantity: 5,
      ownerUserId: requester.id,
      notes: 'Use grey resin',
      sourceUrl: 'https://example.com/model',
      counts: { todo: 5 },
    })
    const repeated = (await repository.getRequest(repeatedId))!
    expect(repeated.filePath).not.toBe('todo/model.stl')
    expect(await new Response((await assets.read(repeated.filePath!)).stream).text()).toBe('stl')
  })

  it('stores a fetched cover once and serves later views from storage', async () => {
    const id = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 1,
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
        requestedPrintType: 'filament',
      },
      requester,
    )
    const cover = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

    expect(await service.cachedSourceImage((await repository.getRequest(id))!)).toBeUndefined()
    await service.cacheSourceImage(id, cover)

    const stored = await repository.getRequest(id)
    expect(stored?.sourceImagePath).toBe(`covers/${id}`)
    expect(await service.cachedSourceImage(stored!)).toEqual(cover)
  })

  it('drops the cached cover when the resolved cover URL changes', async () => {
    const id = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 1,
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
        requestedPrintType: 'filament',
      },
      requester,
    )
    await service.cacheSourceImage(id, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    await service.update(
      id,
      { sourceUrl: 'https://makerworld.com/models/other', sourceImageUrl: 'https://makerworld.bblmw.com/other.png' },
      requester,
    )

    const updated = await repository.getRequest(id)
    expect(updated?.sourceImagePath).toBeUndefined()
    expect(await service.cachedSourceImage(updated!)).toBeUndefined()
    expect(await assets.exists(`covers/${id}`)).toBe(false)
  })

  it('keeps the cached cover when an unrelated field changes', async () => {
    const id = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 1,
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
        requestedPrintType: 'filament',
      },
      requester,
    )
    await service.cacheSourceImage(id, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    await service.update(id, { notes: 'Black PLA' }, requester)

    expect((await repository.getRequest(id))?.sourceImagePath).toBe(`covers/${id}`)
  })

  it('trashes the cached cover along with the rest of a deleted request', async () => {
    const id = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 1,
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
        requestedPrintType: 'filament',
      },
      requester,
    )
    await service.cacheSourceImage(id, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))

    await service.remove(id, requester)

    expect(await assets.exists(`covers/${id}`)).toBe(false)
  })

  describe('a supplied cover', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7])
    const linked = (sourceImageUrl?: string) =>
      service.createLinkedRequest(
        {
          name: 'Dragon',
          quantity: 1,
          sourceUrl: 'https://www.thingiverse.com/thing:763622',
          sourceImageUrl,
          requestedPrintType: 'filament',
        },
        requester,
      )

    it('is stored as the print cover', async () => {
      const id = await linked()

      await service.setCover(id, png, requester)

      expect(await service.cachedSourceImage((await repository.getRequest(id))!)).toEqual(png)
    })

    it('shows on the board in place of the link placeholder', async () => {
      const id = await linked()

      await service.setCover(id, png, requester)

      expect((await service.listRequests(requester)).requests.find((listed) => listed.id === id)?.hasSourceImage).toBe(true)
    })

    it('moves the print update time, so the versioned cover URL changes', async () => {
      const id = await linked()
      const before = (await repository.getRequest(id))!.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 2))

      await service.setCover(id, png, requester)

      expect((await repository.getRequest(id))!.updatedAt).toBeGreaterThan(before)
    })

    it('tells other viewers the print changed', async () => {
      const publish = vi.fn()
      const watched = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
      const id = await linked()

      await watched.setCover(id, png, requester)

      expect(publish).toHaveBeenCalledWith('request.updated')
    })

    it('replaces the cover the source link resolved', async () => {
      const id = await linked('https://makerworld.bblmw.com/logo.png')
      await service.cacheSourceImage(id, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]))

      await service.setCover(id, png, requester)

      const stored = (await repository.getRequest(id))!
      expect({ sourceImageUrl: stored.sourceImageUrl, cover: await service.cachedSourceImage(stored) }).toEqual({
        sourceImageUrl: undefined,
        cover: png,
      })
    })

    it('records an anonymous success event saying whether it replaced a cover', async () => {
      const id = await linked('https://makerworld.bblmw.com/logo.png')
      capture.mockClear()

      await service.setCover(id, png, requester)

      expect(capture).toHaveBeenCalledWith(requester.id, 'request_cover_added', { replaced: true })
    })

    it('is stored when the print is added from a link', async () => {
      const id = await service.createLinkedRequest(
        {
          name: 'Dragon',
          quantity: 1,
          sourceUrl: 'https://cults3d.com/en/3d-model/game/dragon',
          requestedPrintType: 'filament',
          cover: png,
        },
        requester,
      )

      expect(await service.cachedSourceImage((await repository.getRequest(id))!)).toEqual(png)
    })

    it('adds no print when the cover supplied with it is not an image', async () => {
      await expect(
        service.createLinkedRequest(
          {
            name: 'Dragon',
            quantity: 1,
            sourceUrl: 'https://cults3d.com/en/3d-model/game/dragon',
            requestedPrintType: 'filament',
            cover: new TextEncoder().encode('<svg onload="alert(1)"/>'),
          },
          requester,
        ),
      ).rejects.toMatchObject({ status: 400 })
      expect(await repository.listRequests()).toEqual([])
    })

    it('is refused when the bytes are not an image', async () => {
      const id = await linked()

      await expect(service.setCover(id, new TextEncoder().encode('<html></html>'), requester)).rejects.toMatchObject({ status: 400 })
    })

    it('is refused over the size limit', async () => {
      const id = await linked()
      const oversized = new Uint8Array(MAX_COVER_BYTES + 1)
      oversized.set(png)

      await expect(service.setCover(id, oversized, requester)).rejects.toMatchObject({ status: 413 })
    })

    it('is refused from a member who did not request the print', async () => {
      const id = await linked()

      await expect(service.setCover(id, png, otherRequester)).rejects.toMatchObject({ status: 403 })
    })

    it('is refused from the requester once a copy has started', async () => {
      const id = await linked()
      await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1 }, admin)

      await expect(service.setCover(id, png, requester)).rejects.toMatchObject({ status: 403 })
    })

    it('can be set by an administrator on anyone’s print', async () => {
      const id = await linked()

      await service.setCover(id, png, admin)

      expect((await repository.getRequest(id))?.sourceImagePath).toBe(`covers/${id}`)
    })

    it('is refused for a print with a model, whose thumbnail is its picture', async () => {
      const id = await printWithModel('bracket.stl')

      await expect(service.setCover(id, png, requester)).rejects.toMatchObject({ status: 409 })
    })

    it('cannot reach a print in another workspace', async () => {
      await repository.listRequests()
      await repository.database
        .insert(organization)
        .values({ id: 'other-workspace', name: 'Other', slug: 'other', createdAt: new Date() })
        .run()
      const other = await repository.scoped('other-workspace')
      const id = await other.createRequest({ name: 'Other', quantity: 1, sourceUrl: 'https://cults3d.com/x', ownerUserId: requester.id })

      await expect(service.setCover(id, png, admin)).rejects.toMatchObject({ status: 404 })
      expect((await other.getRequest(id))?.sourceImagePath).toBeUndefined()
    })

    it('is copied to a print made again from it', async () => {
      const id = await linked()
      await service.setCover(id, png, requester)

      const repeatedId = await service.repeatRequest(id, 1, requester)

      expect(await service.cachedSourceImage((await repository.getRequest(repeatedId))!)).toEqual(png)
    })
  })

  it('lists each request with the format of its stored model', async () => {
    const linkedId = await service.createLinkedRequest(
      { name: 'Linked', quantity: 1, sourceUrl: 'https://makerworld.com/models/linked', requestedPrintType: 'filament' },
      requester,
    )
    const objId = await printWithModel('Figure.OBJ')
    const threeMfId = await printWithModel('Assembly.3mf')

    const formats = Object.fromEntries((await service.listRequests(requester)).requests.map((listed) => [listed.id, listed.modelFormat]))

    expect(formats).toEqual({ [linkedId]: undefined, [objId]: 'obj', [threeMfId]: '3mf' })
  })

  it('creates and repeats a linked request without model assets', async () => {
    capture.mockClear()

    const id = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 2,
        notes: 'Black PLA',
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
        requestedPrintType: 'filament',
      },
      requester,
    )
    const repeatedId = await service.repeatRequest(id, 3, requester)

    expect(await repository.getRequest(id)).toMatchObject({
      name: 'Cable organizer',
      quantity: 2,
      notes: 'Black PLA',
      sourceUrl: 'https://makerworld.com/models/cable-organizer',
      sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
      fileName: undefined,
      filePath: undefined,
      counts: { todo: 2 },
    })
    expect(await repository.getRequest(repeatedId)).toMatchObject({
      quantity: 3,
      fileName: undefined,
      filePath: undefined,
      sourceImageUrl: 'https://makerworld.bblmw.com/cable-organizer.png',
      counts: { todo: 3 },
    })
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({ hasFile: false, hasSourceImage: true })
    expect(await repository.assetGenerationJobs(id)).toEqual([])
    await expect(service.update(id, { sourceUrl: '' }, requester)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    expect((await repository.getRequest(id))?.sourceUrl).toBe('https://makerworld.com/models/cable-organizer')
    expect(capture).toHaveBeenCalledWith(requester.id, 'request_created', {
      print_type: 'filament',
      assignment_state: 'unassigned',
      model_source: 'link',
    })
  })

  it('only lets the requester or an admin print a request again', async () => {
    const id = await request()

    await expect(service.repeatRequest(id, 1, otherRequester)).rejects.toMatchObject({ status: 403 })
    await expect(service.repeatRequest(id, 1, admin)).resolves.toBeTypeOf('string')
  })

  it('abandons a repeated request when its source STL is missing', async () => {
    const id = await request()
    await assets.remove('todo/model.stl')

    await expect(service.repeatRequest(id, 1, requester)).rejects.toMatchObject({ status: 404 })
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('finishes a repeated request after restarting between asset copy and database commit', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'completeRepeatOperation').mockRejectedValueOnce(new Error('database unavailable'))

    await expect(service.repeatRequest(id, 3, requester)).rejects.toThrow('database unavailable')
    expect(await repository.listOperations()).toMatchObject([{ state: 'assets_moved', payload: { kind: 'repeat' } }])
    failure.mockRestore()

    await service.recoverOperations()
    const repeated = (await repository.listRequests()).find((candidate) => candidate.id !== id)
    expect(repeated).toMatchObject({ quantity: 3, ownerUserId: requester.id, counts: { todo: 3 } })
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('finishes a delete after restarting between the filesystem and database phases', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await repository.listOperations()).toHaveLength(1)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('joins an already pending delete for the same request', async () => {
    const id = await request()
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    failure.mockRestore()

    await expect(service.remove(id, admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await assets.exists('todo/model.stl')).toBe(false)
  })

  it('treats an already deleted request as a completed delete', async () => {
    const id = await request()
    await service.remove(id, admin)

    await expect(service.remove(id, admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('journals original and preview assets with distinct deterministic trash paths', async () => {
    await assets.write('todo/with-preview.stl', new TextEncoder().encode('original'))
    await assets.write('previews/with-preview.stl', new TextEncoder().encode('preview'))
    const id = await repository.createRequest({
      name: 'Previewed',
      fileName: 'with-preview.stl',
      filePath: 'todo/with-preview.stl',
      previewPath: 'previews/with-preview.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const failure = vi.spyOn(repository, 'deleteRequest').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    await expect(service.remove(id, admin)).rejects.toThrow('database unavailable')
    const operation = (await repository.listOperations())[0]
    expect(operation.payload.kind).toBe('delete')
    if (operation.payload.kind === 'delete') expect(new Set(operation.payload.assets.map((asset) => asset.trashPath)).size).toBe(2)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toBeUndefined()
  })

  it('does not report a logical delete as failed when trash cleanup fails', async () => {
    const id = await request()
    vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(service.remove(id, admin)).resolves.toBeUndefined()
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(1)
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('purges owned request assets before allowing account deletion', async () => {
    const id = await request()
    await service.archiveRequests([id], requester)
    expect(await service.listRequests(requester)).toMatchObject({ requests: [] })
    const uploadId = 'owned-incomplete-upload'
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)
    await staging.writeUploadPart(staging.uploadPart(uploadId), new TextEncoder().encode('partial stl'))

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await assets.exists('todo/model.stl')).toBe(false)
    await expect(fs.promises.access(staging.uploadPart(uploadId))).rejects.toThrow()
    expect(removeTusUpload).toHaveBeenCalledWith(uploadId)
    expect(await repository.uploadIdsOwnedBy(requester.id)).toHaveLength(0)
    expect(await repository.listOperations()).toHaveLength(0)
    await expect(repository.database.delete(user).where(eq(user.id, requester.id)).run()).resolves.not.toThrow()
  })

  it('finishes an owned pending move before deleting the account', async () => {
    const id = await request()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await assets.exists('todo/model.stl')).toBe(false)
    expect(await assets.exists('in-progress/model.stl')).toBe(false)
  })

  it('leaves another account pending operations untouched during account deletion', async () => {
    const ownedId = await request()
    await assets.write('todo/admin-model.stl', new TextEncoder().encode('admin model'))
    const otherId = await repository.createRequest({
      name: 'Admin model',
      fileName: 'admin-model.stl',
      filePath: 'todo/admin-model.stl',
      quantity: 1,
      ownerUserId: admin.id,
    })
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: otherId,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/admin-model.stl',
      destinationPath: 'in-progress/admin-model.stl',
    })

    await service.removeOwnedRequests(requester.id)

    expect(await repository.getRequest(ownedId)).toBeUndefined()
    expect(await repository.getRequest(otherId)).toMatchObject({ counts: { todo: 1, in_progress: 0 } })
    expect(await repository.listOperations()).toMatchObject([{ id: operationId }])
    expect(await assets.exists('todo/admin-model.stl')).toBe(true)
  })

  it('keeps the account and request when owned asset cleanup fails', async () => {
    const id = await request()
    const failure = vi.spyOn(assets, 'purgeTrash').mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(service.removeOwnedRequests(requester.id)).rejects.toThrow('storage unavailable')

    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await repository.listOperations()).toHaveLength(1)
    await expect(repository.database.delete(user).where(eq(user.id, requester.id)).run()).rejects.toThrow('FOREIGN KEY constraint failed')

    failure.mockRestore()
    await service.removeOwnedRequests(requester.id)
    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('replays a prepared move idempotently after restart', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toMatchObject({ filePath: 'in-progress/model.stl', counts: { todo: 0, in_progress: 1 } })
    expect(await fs.promises.readFile(assets.absolute('in-progress/model.stl'), 'utf8')).toBe('stl')
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('replays a move when the file was renamed before the process stopped', async () => {
    const id = await request()
    const operationId = crypto.randomUUID()
    await repository.beginOperation(operationId, {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await service.recoverOperations()
    expect(await repository.getRequest(id)).toMatchObject({ filePath: 'done/model.stl', counts: { todo: 0, done: 1 } })
  })

  it('replays a pending operation before removing an old workflow status', async () => {
    const id = await request()
    await repository.database
      .update(requestStatuses)
      .set({ quantity: 0 })
      .where(
        and(eq(requestStatuses.workspaceId, 'test-workspace'), eq(requestStatuses.requestId, id), eq(requestStatuses.statusId, 'todo')),
      )
      .run()
    await repository.database
      .insert(requestStatuses)
      .values({ workspaceId: 'test-workspace', requestId: id, statusId: 'retired', quantity: 1 })
      .run()
    await assets.ensureMoved('todo/model.stl', 'retired/model.stl')
    await repository.database.update(requests).set({ filePath: 'retired/model.stl' }).where(eq(requests.id, id)).run()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'retired',
      toStatus: 'done',
      count: 1,
      sourcePath: 'retired/model.stl',
      destinationPath: 'done/model.stl',
    })
    await expect(repository.reconcileWorkflow()).rejects.toThrow('still has copies')
    await service.recoverOperations()
    await repository.reconcileWorkflow()
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, done: 1 }, filePath: 'done/model.stl' })
    expect((await repository.getRequest(id))?.counts).not.toHaveProperty('retired')
  })

  it('scopes the board per member when the workspace default is overridden', async () => {
    const mine = await request()
    await assets.write('todo/other.stl', new TextEncoder().encode('stl'))
    await repository.createRequest({
      name: 'Theirs',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: otherRequester.id,
    })

    const sharedBoardWithScopedMember = { privateRequests: false, memberVisibility: { [requester.id]: 'own' as const } }
    const scoped = await service.listRequests(requester, seesOnlyOwnRequests(sharedBoardWithScopedMember, requester))
    expect(scoped.requests.map(({ id }) => id)).toEqual([mine])
    const unscoped = await service.listRequests(otherRequester, seesOnlyOwnRequests(sharedBoardWithScopedMember, otherRequester))
    expect(unscoped.requests).toHaveLength(2)

    const privateBoardWithTrustedMember = { privateRequests: true, memberVisibility: { [requester.id]: 'all' as const } }
    const trusted = await service.listRequests(requester, seesOnlyOwnRequests(privateBoardWithTrustedMember, requester))
    expect(trusted.requests).toHaveLength(2)
    const stillPrivate = await service.listRequests(otherRequester, seesOnlyOwnRequests(privateBoardWithTrustedMember, otherRequester))
    expect(stillPrivate.requests).toHaveLength(1)
  })

  it('filters requests to the owner in private mode and lets requesters manage their own', async () => {
    const mine = await request()
    await assets.write('todo/other.stl', new TextEncoder().encode('stl'))
    const theirs = await repository.createRequest({
      name: 'Theirs',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: otherRequester.id,
    })

    const shared = await service.listRequests(requester, false)
    expect(shared.requests).toHaveLength(2)
    const privately = await service.listRequests(requester, true)
    expect(privately.requests).toHaveLength(1)
    expect(privately.requests[0]).toMatchObject({ id: mine, mine: true, canDelete: true })
    expect((await service.listRequests({ ...requester, email: 'renamed@example.com' }, true)).requests[0]).toMatchObject({
      id: mine,
      mine: true,
    })
    expect((await service.listRequests(admin, true)).requests).toHaveLength(2)

    capture.mockClear()
    await service.reorder(mine, 'todo', 3, requester)
    expect(capture).toHaveBeenCalledWith(requester.id, 'request_reordered', { status: 'todo' })
    await expect(service.reorder(mine, 'in_progress', 2, requester)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.reorder(theirs, 'todo', 2, admin)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.reorder(mine, 'todo', 4, { ...otherRequester, email: requester.email })).rejects.toThrow(
      expect.objectContaining({ status: 403 }),
    )
    await expect(service.reorder(theirs, 'todo', 3, requester)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    await expect(service.remove(theirs, requester)).rejects.toMatchObject({ status: 403 })
    await service.remove(mine, requester)
    expect(await repository.getRequest(mine)).toBeUndefined()
  })

  it('exposes configured printer assignments and rejects unknown printers', async () => {
    await stock('printers', [slaPrinter])
    await repository.setSetting(PRINT_TYPE_SETTING, 'both')
    const id = await repository.createRequest({
      name: 'Assigned',
      fileName: 'assigned.stl',
      filePath: 'todo/assigned.stl',
      quantity: 1,
      ownerUserId: requester.id,
      printerId: slaPrinter.id,
    })

    expect((await service.listRequests(admin)).requests).toEqual([
      expect.objectContaining({ id, printer: { id: slaPrinter.id, name: slaPrinter.name, printType: 'resin' } }),
    ])
    await expect(service.update(id, { printerId: 'missing-printer' }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { printerId: null }, requester)).rejects.toThrow(expect.objectContaining({ status: 403 }))
    expect(await service.update(id, { requestedPrintType: 'filament' }, requester)).toEqual({ printTypeChanged: true })
    expect(await repository.getRequest(id)).toMatchObject({ printerId: undefined, requestedPrintType: 'filament' })
  })

  it('rejects a new print of a type the workspace does not print', async () => {
    await stock('printers', [slaPrinter])
    await expect(
      service.createLinkedRequest(
        { name: 'Bracket', quantity: 1, sourceUrl: 'https://makerworld.com/models/bracket', requestedPrintType: 'filament' },
        requester,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects changing a print to a type the workspace does not print', async () => {
    await repository.setSetting(PRINT_TYPE_SETTING, 'resin')
    const id = await service.createLinkedRequest(
      { name: 'Bracket', quantity: 1, sourceUrl: 'https://makerworld.com/models/bracket', requestedPrintType: 'resin' },
      requester,
    )
    await expect(service.update(id, { requestedPrintType: 'filament' }, requester)).rejects.toMatchObject({ status: 400 })
  })

  it('keeps a print of a type the workspace no longer prints editable', async () => {
    const id = await service.createLinkedRequest(
      { name: 'Bracket', quantity: 1, sourceUrl: 'https://makerworld.com/models/bracket', requestedPrintType: 'filament' },
      requester,
    )
    await repository.setSetting(PRINT_TYPE_SETTING, 'resin')
    expect(await service.update(id, { name: 'Bracket v2', requestedPrintType: 'filament' }, admin)).toEqual({ printTypeChanged: false })
  })

  it('validates assignment-first request targets', async () => {
    await stock('printers', [slaPrinter, filamentPrinter])
    await expect(
      service.createRequest(
        {
          name: 'Conflicting target',
          fileName: 'wrong.stl',
          filePath: 'todo/wrong.stl',
          quantity: 1,
          requestedPrintType: 'filament',
          printerId: slaPrinter.id,
        },
        admin,
      ),
    ).rejects.toThrow(expect.objectContaining({ status: 400 }))

    const id = await service.createRequest(
      {
        name: 'Filament model',
        fileName: 'filament.stl',
        filePath: 'todo/filament.stl',
        quantity: 1,
        printerId: filamentPrinter.id,
      },
      admin,
    )

    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: filamentPrinter.id })
    expect(await service.update(id, { requestedPrintType: 'filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: filamentPrinter.id })
    expect(await service.update(id, { notes: 'Still filament' }, admin)).toEqual({ printTypeChanged: false })
    expect(await service.update(id, { printerId: slaPrinter.id }, admin)).toEqual({ printTypeChanged: true })
    expect(await repository.getRequest(id)).toMatchObject({ requestedPrintType: undefined, printerId: slaPrinter.id })
  })

  it('automatically assigns outstanding copies relative to build plate area', async () => {
    await stock('printers', [slaPrinter, largeResinPrinter])
    for (const printer of [slaPrinter, largeResinPrinter]) {
      await repository.createRequest({
        name: `${printer.name} workload`,
        fileName: `${printer.id}.stl`,
        filePath: `todo/${printer.id}.stl`,
        quantity: 1,
        ownerUserId: requester.id,
        printerId: printer.id,
      })
    }

    const id = await service.createRequest(
      {
        name: 'Automatically assigned',
        fileName: 'automatic.stl',
        filePath: 'todo/automatic.stl',
        quantity: 1,
        requestedPrintType: 'resin',
      },
      requester,
    )

    expect((await repository.getRequest(id))?.printerId).toBe(largeResinPrinter.id)
  })

  it('assigns several prints to one printer at once', async () => {
    await stock('printers', [slaPrinter, largeResinPrinter])
    const ids = [await request(), await request()]

    await service.assignRequests(ids, largeResinPrinter.id, admin)

    expect((await Promise.all(ids.map((id) => repository.getRequest(id)))).map((print) => print?.printerId)).toEqual([
      largeResinPrinter.id,
      largeResinPrinter.id,
    ])
  })

  it('lets only admins assign prints to a printer', async () => {
    await stock('printers', [slaPrinter])

    await expect(service.assignRequests([await request()], slaPrinter.id, requester)).rejects.toMatchObject({ status: 403 })
  })

  it('leaves a new print on its print type when the workspace assigns printers by hand', async () => {
    await stock('printers', [slaPrinter, largeResinPrinter])
    await repository.setSetting('board', { manualPrinterAssignment: true })

    const id = await service.createRequest(
      { name: 'Unassigned', fileName: 'unassigned.stl', filePath: 'todo/unassigned.stl', quantity: 1, requestedPrintType: 'resin' },
      requester,
    )

    expect(await repository.getRequest(id)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
  })

  it('archives prints out of the board and moves them back with their stages intact', async () => {
    const id = await request()
    await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
    capture.mockClear()

    await service.archiveRequests([id], admin)

    expect(await repository.getRequest(id)).toMatchObject({ counts: { done: 1 }, archivedAt: expect.any(Number) })
    expect(await service.listRequests(admin)).toMatchObject({ requests: [], groups: [] })
    expect((await service.listRequests(admin, false, { archived: true })).requests.map(({ id: archivedId }) => archivedId)).toEqual([id])
    expect((await service.listRequests(admin, false, { archived: true })).requests[0]).toMatchObject({
      canArchive: true,
      counts: { done: 1 },
    })
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_archived', { print_type: undefined, copy_count: 1 })

    capture.mockClear()
    await service.unarchiveRequests([id], admin)

    expect(await repository.getRequest(id)).toMatchObject({ counts: { done: 1 }, archivedAt: undefined })
    expect((await service.listRequests(admin)).requests.map(({ id: restoredId }) => restoredId)).toEqual([id])
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_unarchived', { print_type: undefined, copy_count: 1 })
  })

  it('archives a selection of more than a hundred prints at once', async () => {
    const ids = await Promise.all(Array.from({ length: 101 }, () => request()))
    await Promise.all(ids.map((id) => service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)))

    await service.archiveRequests(ids, admin)

    expect((await service.listRequests(admin, false, { archived: true })).requests).toHaveLength(101)
  })

  describe('automatic archiving', () => {
    const DAY = 24 * 60 * 60 * 1000

    async function readyRequest() {
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
      return { id, readyAt: (await repository.getRequest(id))!.completedAt! }
    }

    it('leaves Ready prints on the board while the setting is off', async () => {
      const { id, readyAt } = await readyRequest()

      await service.autoArchiveReadyRequests(readyAt + 365 * DAY)

      expect((await repository.getRequest(id))?.archivedAt).toBeUndefined()
    })

    it('archives prints that have been Ready for the configured days', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()

      await service.autoArchiveReadyRequests(readyAt + 7 * DAY)

      expect((await repository.getRequest(id))?.archivedAt).toBe(readyAt + 7 * DAY)
    })

    it('keeps prints that became Ready more recently than the configured days', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()

      await service.autoArchiveReadyRequests(readyAt + 7 * DAY - 1)

      expect((await repository.getRequest(id))?.archivedAt).toBeUndefined()
    })

    it('keeps a restored print on the board until the delay passes again', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()
      await service.autoArchiveReadyRequests(readyAt + 8 * DAY)
      vi.useFakeTimers({ now: readyAt + 9 * DAY, toFake: ['Date'] })
      await service.unarchiveRequests([id], admin)
      vi.useRealTimers()

      await service.autoArchiveReadyRequests(readyAt + 10 * DAY)

      expect((await repository.getRequest(id))?.archivedAt).toBeUndefined()
    })

    it('archives a restored print again once the delay has passed since it was restored', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()
      await service.autoArchiveReadyRequests(readyAt + 8 * DAY)
      vi.useFakeTimers({ now: readyAt + 9 * DAY, toFake: ['Date'] })
      await service.unarchiveRequests([id], admin)
      vi.useRealTimers()

      await service.autoArchiveReadyRequests(readyAt + 16 * DAY)

      expect((await repository.getRequest(id))?.archivedAt).toBe(readyAt + 16 * DAY)
    })

    it('publishes an archive event and captures the count when prints are archived', async () => {
      const publish = vi.fn()
      service = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { readyAt } = await readyRequest()
      capture.mockClear()

      await service.autoArchiveReadyRequests(readyAt + 8 * DAY)

      expect(publish).toHaveBeenCalledWith('request.archived')
      expect(capture).toHaveBeenCalledWith('server', 'requests_auto_archived', { request_count: 1, auto_archive_days: 7 })
    })

    it('keeps a print whose copy leaves Ready between the sweep reading and archiving it', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()
      const queryRequests = repository.queryRequests.bind(repository)
      vi.spyOn(repository, 'queryRequests').mockImplementationOnce(async (query) => {
        const result = await queryRequests(query)
        await repository.moveCopies({ id, from: 'done', to: 'post_processing', count: 1 })
        return result
      })

      await service.autoArchiveReadyRequests(readyAt + 8 * DAY)

      expect((await repository.getRequest(id))?.archivedAt).toBeUndefined()
    })

    it('archives a print once when two sweeps overlap', async () => {
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { id, readyAt } = await readyRequest()

      const counts = await Promise.all([
        service.autoArchiveReadyRequests(readyAt + 8 * DAY),
        service.autoArchiveReadyRequests(readyAt + 9 * DAY),
      ])

      const archivedAt = (await repository.getRequest(id))?.archivedAt
      expect({ counts, archivedAt }).toEqual({ counts: [1, 0], archivedAt: readyAt + 8 * DAY })
    })

    it('publishes nothing when no print is due', async () => {
      const publish = vi.fn()
      service = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
      await repository.setSetting('board', { privateRequests: false, autoArchiveDays: 7 })
      const { readyAt } = await readyRequest()
      publish.mockClear()

      await service.autoArchiveReadyRequests(readyAt + DAY)

      expect(publish).not.toHaveBeenCalled()
    })
  })

  it('blocks requesters from archiving a request once a copy has started', async () => {
    const id = await request()
    await expect(service.archiveRequests([id], requester)).resolves.toBeUndefined()
    await service.unarchiveRequests([id], requester)
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)

    await expect(service.archiveRequests([id], requester)).rejects.toMatchObject({ status: 403 })
    expect((await service.listRequests(requester, true)).requests[0]).toMatchObject({ canArchive: false, canDelete: false })
    // Restoring visibility is always allowed — an operator may archive a started request back to the owner.
    await service.archiveRequests([id], admin)
    await expect(service.unarchiveRequests([id], requester)).resolves.toBeUndefined()
    expect(await repository.getRequest(id)).toMatchObject({ counts: { in_progress: 1 }, archivedAt: undefined })
  })

  it('lets only the owner or an admin archive a print', async () => {
    const id = await request()
    await assets.write('todo/other.stl', new TextEncoder().encode('stl'))
    const theirs = await repository.createRequest({
      name: 'Theirs',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: otherRequester.id,
    })

    await expect(service.archiveRequests([], requester)).rejects.toMatchObject({ status: 400 })
    await expect(service.archiveRequests([theirs], requester)).rejects.toMatchObject({ status: 403 })
    await expect(service.archiveRequests([id], otherRequester)).rejects.toMatchObject({ status: 403 })
    await service.archiveRequests(['missing'], admin)
    expect(await repository.listRequests()).toHaveLength(2)
    await service.archiveRequests([theirs, id], admin)
    expect((await repository.getRequest(theirs))?.archivedAt).toBeTypeOf('number')
    expect((await repository.getRequest(id))?.archivedAt).toBeTypeOf('number')
  })

  it('blocks requester deletion once a copy has started', async () => {
    const id = await request()
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    await expect(service.remove(id, requester)).rejects.toMatchObject({ status: 403 })
    expect((await service.listRequests(requester, true)).requests[0]).toMatchObject({ canDelete: false })
  })

  it('lets requesters rename their own queued requests', async () => {
    const id = await request()
    await service.update(id, { name: 'Renamed model' }, requester)
    expect((await repository.getRequest(id))?.name).toBe('Renamed model')
  })

  it('returns public role-aware requests and enforces requester authorization', async () => {
    const id = await request()
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({
      id: id,
      mine: true,
      canEdit: true,
      canDelete: true,
      hasPreview: false,
    })
    expect((await service.listRequests(requester)).requests[0]).not.toHaveProperty('filePath')
    expect((await service.listRequests(requester)).requests[0]).not.toHaveProperty('requesterEmail')
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({ canEdit: false, canDelete: false })
    await expect(service.update(id, { notes: 'changed' }, requester)).rejects.toThrow()
  })

  it('reports whether estimate geometry is still processing or unavailable', async () => {
    const id = await request()
    expect((await service.listRequests(requester)).requests[0]).toMatchObject({ estimateGeometryStatus: 'pending' })

    await repository.startAssetGeneration(id, ['geometry'])
    await repository.finishAssetGeneration(id, 'geometry', { status: 'skipped' })

    expect((await service.listRequests(requester)).requests[0]).toMatchObject({ estimateGeometryStatus: 'skipped' })
  })

  it('stops checking printer fit once geometry fails for an unreadable model', async () => {
    await assets.write('todo/broken.obj', new TextEncoder().encode('v 0 0 0\nf 1 2 3\n'))
    const id = await repository.createRequest({
      name: 'Broken',
      fileName: 'broken.obj',
      filePath: 'todo/broken.obj',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'resin',
    })
    await repository.startAssetGeneration(id, ['geometry'])
    await repository.finishAssetGeneration(id, 'geometry', { status: 'failed', error: 'invalid OBJ face index', failureKind: 'permanent' })

    expect((await service.listRequests(requester)).requests[0].fitState).toBeUndefined()
  })

  it('passes server filters through without exposing private searchable metadata to requesters', async () => {
    await request()
    expect((await service.listRequests(requester, false, { query: 'model.stl' })).requests).toHaveLength(0)
    expect((await service.listRequests(admin, false, { query: 'model.stl' })).requests).toHaveLength(1)
  })

  it('filters and sorts requests by their effective print estimates', async () => {
    const first = await repository.createRequest({
      name: 'Five grams',
      fileName: 'first.stl',
      filePath: 'todo/first.stl',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'filament',
    })
    const second = await repository.createRequest({
      name: 'Ten grams',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'filament',
    })
    const missing = await repository.createRequest({
      name: 'Still analyzing',
      fileName: 'missing.stl',
      filePath: 'todo/missing.stl',
      quantity: 1,
      ownerUserId: requester.id,
      requestedPrintType: 'filament',
    })
    await repository.updateRequest(first, { estimatedMaterialOverride: 5, estimatedPrintMinutesOverride: 60 })
    await repository.updateRequest(second, { estimatedMaterialOverride: 10, estimatedPrintMinutesOverride: 30 })

    expect((await service.listRequests(admin, false, { sort: 'material-asc' })).requests.map(({ id }) => id)).toEqual([
      first,
      second,
      missing,
    ])
    expect((await service.listRequests(admin, false, { sort: 'time-asc' })).requests.map(({ id }) => id)).toEqual([second, first, missing])
    expect((await service.listRequests(admin, false, { maxEstimatedMaterial: 7 })).requests.map(({ id }) => id)).toEqual([first])
    expect((await service.listRequests(admin, false, { minEstimatedMaterial: 7 })).requests.map(({ id }) => id)).toEqual([second])
    expect(
      (await service.listRequests(admin, false, { minEstimatedMaterial: 4, maxEstimatedMaterial: 7 })).requests.map(({ id }) => id),
    ).toEqual([first])
  })

  describe('material estimates', () => {
    async function modelledResinPrint() {
      const id = await request()
      await repository.updateRequest(id, { requestedPrintType: 'resin' })
      await repository.setModelDimensions(id, { widthMm: 10, depthMm: 10, heightMm: 20 }, 10_000, 3_000)
      return id
    }

    async function listed(id: string) {
      return (await service.listRequests(admin)).requests.find((candidate) => candidate.id === id)!
    }

    it('adds the default resin allowance to a listed print', async () => {
      const id = await modelledResinPrint()

      expect((await listed(id)).automaticEstimatedMaterial).toBeCloseTo(17)
    })

    it('applies a changed allowance to existing prints on the next read', async () => {
      const id = await modelledResinPrint()
      await repository.setSetting(PRICE_CALCULATOR_SETTING, {
        ...DEFAULT_PRICE_CALCULATOR_SETTINGS,
        supportsAndWastePercent: { resin: 50, filament: 10 },
      })

      expect((await listed(id)).automaticEstimatedMaterial).toBeCloseTo(16)
    })

    it('keeps an adjusted material as entered', async () => {
      const id = await modelledResinPrint()
      await repository.updateRequest(id, { estimatedMaterialOverride: 12 })

      expect(requestPrintEstimate(await listed(id))?.material).toBe(12)
    })
  })

  it('rejects oversized or malformed updates before persistence', async () => {
    const id = await request()
    await expect(service.update(id, { name: 'x'.repeat(121) }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { notes: 'x'.repeat(2001) }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { quantity: 1.5 }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { sourceUrl: 'ftp://example.com/model' }, admin)).rejects.toThrow(
      expect.objectContaining({ status: 400 }),
    )
    await expect(service.update(id, { sourceUrl: 'not a url' }, admin)).rejects.toThrow(expect.objectContaining({ status: 400 }))
    await expect(service.update(id, { sourceUrl: `https://example.com/${'x'.repeat(500)}` }, admin)).rejects.toThrow(
      expect.objectContaining({ status: 400 }),
    )
    await service.update(id, { sourceUrl: 'https://example.com/model' }, admin)
    expect((await repository.getRequest(id))?.sourceUrl).toBe('https://example.com/model')
    await service.update(id, { sourceUrl: '' }, admin)
    expect((await repository.getRequest(id))?.sourceUrl).toBeFalsy()
    await service.update(id, { estimatedMaterialOverride: 42.5, estimatedPrintMinutesOverride: 90 }, admin)
    expect(await repository.getRequest(id)).toMatchObject({ estimatedMaterialOverride: 42.5, estimatedPrintMinutesOverride: 90 })
    await service.update(id, { estimatedMaterialOverride: null, estimatedPrintMinutesOverride: null }, admin)
    expect(await repository.getRequest(id)).not.toMatchObject({
      estimatedMaterialOverride: expect.anything(),
      estimatedPrintMinutesOverride: expect.anything(),
    })
    expect((await repository.getRequest(id))?.name).toBe('Model')
  })

  it('trashes generated thumbnails alongside the original on delete', async () => {
    const id = await request()
    await assets.write('thumbnails/model.png', new TextEncoder().encode('png bytes'))
    await repository.completeAssetGeneration(id, { thumbnailPath: 'thumbnails/model.png' })
    expect((await repository.getRequest(id))!.hasThumbnail).toBe(true)
    await service.remove(id, admin)
    expect(await assets.exists('thumbnails/model.png')).toBe(false)
  })

  it('surfaces an unwritable destination instead of silently dropping the upload', async () => {
    const part = staging.uploadPart('unwritable-destination-upload')
    await fs.promises.writeFile(part, 'stl')
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    const failure = vi.spyOn(assets, 'finalizeUpload').mockRejectedValue(enoent)
    await repository.createUploadSession('unwritable-destination-upload', admin.id, Date.now() + 60_000, 3)
    await expect(
      service.createUploadedRequest(
        'unwritable-destination-upload',
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('ENOENT')
    // The staged part survives and the journal entry stays, so the upload
    // completes once storage is reachable again.
    expect(await fs.promises.readFile(part, 'utf8')).toBe('stl')
    expect(await repository.listOperations()).toHaveLength(1)
    expect(await repository.listRequests()).toHaveLength(0)
    failure.mockRestore()
    await service.recoverOperations()
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('keeps a journaled upload recoverable when metadata insertion fails', async () => {
    const part = staging.uploadPart('metadata-failure-upload')
    await fs.promises.writeFile(part, 'stl')
    const failure = vi.spyOn(repository, 'completeUploadOperation').mockImplementationOnce(() => {
      throw new Error('database full')
    })
    await repository.createUploadSession('metadata-failure-upload', admin.id, Date.now() + 60_000, 3)
    await expect(
      service.createUploadedRequest(
        'metadata-failure-upload',
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('database full')
    expect(await repository.listOperations()).toHaveLength(1)
    expect(await fs.promises.readdir(assets.absolute('models'))).toHaveLength(1)
    failure.mockRestore()
    const retried = await service.createUploadedRequest(
      'metadata-failure-upload',
      part,
      {
        name: 'Model',
        fileName: 'model.stl',
        quantity: 1,
      },
      admin,
    )
    expect(retried).toBeTruthy()
    expect(await repository.listRequests()).toHaveLength(1)
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('moves copies without touching the stored model', async () => {
    const id = await request()
    const moveAsset = vi.spyOn(assets, 'ensureMoved')

    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1 }, admin)

    expect(moveAsset).not.toHaveBeenCalled()
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 }, filePath: 'todo/model.stl' })
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('recovers when the original finalize fails transiently', async () => {
    const uploadId = 'original-finalize-retry'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    vi.spyOn(assets, 'finalizeUpload').mockRejectedValueOnce(new Error('original filesystem failure'))
    await expect(
      service.createUploadedRequest(
        uploadId,
        part,
        {
          name: 'Model',
          fileName: 'model.stl',
          quantity: 1,
        },
        admin,
      ),
    ).rejects.toThrow('original filesystem failure')
    expect(await repository.listOperations()).toHaveLength(1)
    vi.restoreAllMocks()
    await service.recoverOperations()
    expect((await repository.listRequests())[0]).toMatchObject({ name: 'Model' })
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('recovers an upload whose destination was published before its staged part was removed', async () => {
    const uploadId = 'published-before-cleanup'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    vi.spyOn(assets, 'finalizeUpload').mockImplementationOnce(async (stagedPath, relativePath) => {
      await assets.write(relativePath, await fs.promises.readFile(stagedPath))
      throw new Error('interrupted before staged cleanup')
    })
    await expect(
      service.createUploadedRequest(uploadId, part, { name: 'Model', fileName: 'model.stl', quantity: 1 }, admin),
    ).rejects.toThrow('interrupted before staged cleanup')
    vi.restoreAllMocks()

    await service.recoverOperations()

    const [created] = await repository.listRequests()
    expect(created).toMatchObject({ name: 'Model' })
    expect(await fs.promises.readFile(assets.absolute(created.filePath!), 'utf8')).toBe('stl')
    expect(await staging.size(part)).toBe(0)
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('keeps an upload journaled when its destination holds a different file', async () => {
    const uploadId = 'unrelated-destination'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    vi.spyOn(assets, 'finalizeUpload').mockImplementationOnce(async (_stagedPath, relativePath) => {
      await assets.write(relativePath, new TextEncoder().encode('another model'))
      throw new Error('interrupted before staged cleanup')
    })
    await expect(
      service.createUploadedRequest(uploadId, part, { name: 'Model', fileName: 'model.stl', quantity: 1 }, admin),
    ).rejects.toThrow('interrupted before staged cleanup')
    vi.restoreAllMocks()

    await expect(service.recoverOperations()).rejects.toThrow('upload destination already exists')

    const [operation] = await repository.listOperations()
    expect(operation.payload.kind).toBe('upload')
    const destination = (operation.payload as { destinationPath: string }).destinationPath
    expect(await fs.promises.readFile(assets.absolute(destination), 'utf8')).toBe('another model')
    expect(await fs.promises.readFile(part, 'utf8')).toBe('stl')
    expect(await repository.listRequests()).toHaveLength(0)
  })

  it('terminally reconciles a stale conflicting move instead of poisoning every startup', async () => {
    const id = await request()
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'done',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'done/model.stl',
    })
    await assets.ensureMoved('todo/model.stl', 'done/model.stl')
    await repository.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, filePath: 'todo/model.stl' })
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await fs.promises.readFile(assets.absolute('todo/model.stl'), 'utf8')).toBe('stl')
    await service.recoverOperations()
  })

  it('returns the original request for an ambiguous final-upload retry', async () => {
    const uploadId = 'ambiguous-upload-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    const input = { name: 'Model', fileName: 'model.stl', quantity: 1 }
    const first = await service.createUploadedRequest(uploadId, part, input, admin)
    const second = await service.createUploadedRequest(uploadId, part, input, admin)
    expect(second).toBe(first)
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('attaches a model to a link-only request without losing its queue position', async () => {
    capture.mockClear()
    const requestId = await service.createLinkedRequest(
      {
        name: 'Cable organizer',
        quantity: 2,
        notes: 'Black PLA',
        sourceUrl: 'https://makerworld.com/models/cable-organizer',
        requestedPrintType: 'filament',
      },
      requester,
    )
    const uploadId = 'attach-upload-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)

    expect(await service.attachModel(uploadId, part, requestId, 'organizer.stl', requester)).toBe(requestId)

    const attached = await repository.getRequest(requestId)
    expect(attached).toMatchObject({
      fileName: 'organizer.stl',
      quantity: 2,
      notes: 'Black PLA',
      sourceUrl: 'https://makerworld.com/models/cable-organizer',
      counts: { todo: 2 },
    })
    expect(await assets.exists(attached!.filePath!)).toBe(true)
    expect(capture).toHaveBeenCalledWith(requester.id, 'request_model_attached', { print_type: 'filament', replaced: false })
  })

  it('returns the same request when an attach upload is retried', async () => {
    const requestId = await service.createLinkedRequest(
      { name: 'Cable organizer', quantity: 1, sourceUrl: 'https://makerworld.com/models/x', requestedPrintType: 'filament' },
      requester,
    )
    const uploadId = 'attach-retry-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)

    const first = await service.attachModel(uploadId, part, requestId, 'organizer.stl', requester)
    const second = await service.attachModel(uploadId, part, requestId, 'organizer.stl', requester)

    expect(second).toBe(first)
    expect(await repository.listRequests()).toHaveLength(1)
  })

  it('replaces a model with a newer file and drops everything derived from the old mesh', async () => {
    const requestId = await printWithModel('bracket.stl')
    const original = (await repository.getRequest(requestId))!.filePath!
    await repository.queueAssetGeneration(requestId)
    await repository.setModelDimensions(requestId, { widthMm: 10, depthMm: 20, heightMm: 30 }, 400, 500)
    await repository.finishAssetGeneration(requestId, 'thumbnail', { status: 'ready', path: 'thumbnails/bracket.png' })
    await repository.finishAssetGeneration(requestId, 'preview', { status: 'ready', path: 'previews/bracket.phm' })
    await repository.finishAssetGeneration(requestId, 'geometry', { status: 'ready' })
    capture.mockClear()

    expect(await upload(requestId, 'bracket-v2.stl', 'revised')).toBe(requestId)

    const replaced = (await repository.getRequest(requestId))!
    expect(replaced.fileName).toBe('bracket-v2.stl')
    expect(await readAsset(replaced.filePath!)).toBe('revised')
    expect(replaced.thumbnailPath).toBeUndefined()
    expect(replaced.previewPath).toBeUndefined()
    expect(replaced.modelDimensions).toBeUndefined()
    expect(replaced.modelVolumeMm3).toBeUndefined()
    expect((await repository.assetGenerationJobs(requestId)).map((job) => [job.stage, job.status])).toEqual([
      ['geometry', 'pending'],
      ['preview', 'pending'],
      ['thumbnail', 'pending'],
    ])
    expect(await assets.exists(original)).toBe(false)
    expect(await assets.exists('thumbnails/bracket.png')).toBe(false)
    expect(await assets.exists('previews/bracket.phm')).toBe(false)
    expect(await fs.promises.readdir(assets.absolute('trash'))).toEqual([])
    expect(capture).toHaveBeenCalledWith(requester.id, 'request_model_attached', { print_type: 'filament', replaced: true })
  })

  it('overwrites the stored model when a replacement keeps the same file name', async () => {
    const requestId = await printWithModel('bracket.stl')
    const original = (await repository.getRequest(requestId))!.filePath!

    await upload(requestId, 'bracket.stl', 'revised')

    expect((await repository.getRequest(requestId))!.filePath).toBe(original)
    expect(await readAsset(original)).toBe('revised')
    expect(await fs.promises.readdir(assets.absolute('trash'))).toEqual([])
  })

  it('keeps the saved cover when the model is replaced', async () => {
    const requestId = await printWithModel('bracket.stl')
    await repository.recordSourceImagePath(requestId, `covers/${requestId}`)
    await assets.write(`covers/${requestId}`, new TextEncoder().encode('jpeg'))

    await upload(requestId, 'bracket-v2.stl', 'revised')

    expect((await repository.getRequest(requestId))!.sourceImagePath).toBe(`covers/${requestId}`)
    expect(await assets.exists(`covers/${requestId}`)).toBe(true)
  })

  it('restores the previous model when an interrupted replace is abandoned at startup', async () => {
    const requestId = await printWithModel('bracket.stl')
    const original = (await repository.getRequest(requestId))!.filePath!
    const uploadId = 'replace-interrupted-id'
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)
    const operationId = crypto.randomUUID()
    await repository.beginUploadOperation(operationId, {
      kind: 'attach',
      uploadId,
      ownerId: requester.id,
      requestId,
      partPath: staging.uploadPart(uploadId),
      destinationPath: assets.createPath(requestId, 'bracket-v2.stl'),
      replaced: [{ originalPath: original, trashPath: assets.trashPath(operationId, original) }],
      fileName: 'bracket-v2.stl',
    })

    await service.recoverOperations()

    expect(await repository.listOperations()).toHaveLength(0)
    const unchanged = (await repository.getRequest(requestId))!
    expect(unchanged.fileName).toBe('bracket.stl')
    expect(unchanged.filePath).toBe(original)
    expect(await readAsset(original)).toBe('stl')
  })

  it('refuses a replace once a copy has started printing', async () => {
    const requestId = await printWithModel('bracket.stl')
    await service.moveCopies({ id: requestId, from: 'todo', to: 'up_next', count: 1 }, admin)

    await expect(upload(requestId, 'bracket-v2.stl', 'revised')).rejects.toThrow(expect.objectContaining({ status: 403 }))
    expect((await repository.getRequest(requestId))!.fileName).toBe('bracket.stl')
  })

  it('refuses an attach from someone who does not own the request', async () => {
    const requestId = await service.createLinkedRequest(
      { name: 'Cable organizer', quantity: 1, sourceUrl: 'https://makerworld.com/models/x', requestedPrintType: 'filament' },
      requester,
    )
    const uploadId = 'attach-forbidden-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, otherRequester.id, Date.now() + 60_000, 3)

    await expect(service.attachModel(uploadId, part, requestId, 'other.stl', otherRequester)).rejects.toThrow(
      expect.objectContaining({ status: 403 }),
    )
    expect((await repository.getRequest(requestId))?.filePath).toBeUndefined()
  })

  it('replays a journaled attach whose staged file was already consumed', async () => {
    const requestId = await service.createLinkedRequest(
      { name: 'Cable organizer', quantity: 1, sourceUrl: 'https://makerworld.com/models/x', requestedPrintType: 'filament' },
      requester,
    )
    const uploadId = 'attach-interrupted-id'
    const part = staging.uploadPart(uploadId)
    await fs.promises.writeFile(part, 'stl')
    await repository.createUploadSession(uploadId, requester.id, Date.now() + 60_000, 3)
    const failure = vi.spyOn(repository, 'completeAttachOperation').mockImplementationOnce(() => {
      throw new Error('database full')
    })

    await expect(service.attachModel(uploadId, part, requestId, 'organizer.stl', requester)).rejects.toThrow('database full')
    expect((await repository.getRequest(requestId))?.filePath).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(1)

    failure.mockRestore()
    await service.recoverOperations()

    expect(await repository.listOperations()).toHaveLength(0)
    expect((await repository.getRequest(requestId))?.fileName).toBe('organizer.stl')
  })

  it('cleans an upload journal whose staged files disappeared before startup replay', async () => {
    const uploadId = 'missing-staged-upload'
    await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
    await repository.beginUploadOperation(crypto.randomUUID(), {
      kind: 'upload',
      uploadId,
      ownerId: admin.id,
      requestId: crypto.randomUUID(),
      partPath: staging.uploadPart(uploadId),
      destinationPath: 'todo/missing.stl',
      request: { name: 'Missing', fileName: 'missing.stl', quantity: 1, ownerUserId: admin.id },
    })
    await service.recoverOperations()
    expect(await repository.listOperations()).toHaveLength(0)
    expect(await repository.listRequests()).toHaveLength(0)
  })

  it('moves a validated batch atomically while splitting quantities between stages', async () => {
    await assets.write('todo/first.stl', new TextEncoder().encode('first'))
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const first = await repository.createRequest({
      name: 'First',
      fileName: 'first.stl',
      filePath: 'todo/first.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })

    capture.mockClear()
    await service.moveCopiesBatch(
      [
        { id: first, from: 'todo', to: 'up_next', count: 2 },
        { id: second, from: 'todo', to: 'up_next', count: 2 },
      ],
      admin,
    )

    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 2 })
    expect((await repository.getRequest(second))?.counts).toMatchObject({ todo: 0, up_next: 2 })
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_batch_moved', {
      request_count: 2,
      copy_count: 4,
      from_statuses: ['todo'],
      to_statuses: ['up_next'],
      print_types: [],
    })
  })

  it('keeps prepared copies grouped when moving a print group', async () => {
    await assets.write('todo/first.stl', new TextEncoder().encode('first'))
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const first = await repository.createRequest({
      name: 'First',
      fileName: 'first.stl',
      filePath: 'todo/first.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    await service.moveCopiesBatch(
      [
        { id: first, from: 'todo', to: 'up_next', count: 2 },
        { id: second, from: 'todo', to: 'up_next', count: 1 },
      ],
      admin,
    )
    const groupId = await service.createGroup(
      {
        name: 'Dragon plate',
        status: 'up_next',
        items: [
          { requestId: first, count: 2 },
          { requestId: second, count: 1 },
        ],
      },
      admin,
    )

    capture.mockClear()
    await service.moveGroup(groupId, 'up_next', 'in_progress', admin)

    expect((await repository.getGroup(groupId))?.status).toBe('in_progress')
    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 0, in_progress: 2 })
    expect((await repository.getRequest(second))?.counts).toMatchObject({ up_next: 0, in_progress: 1 })
    expect(capture).toHaveBeenCalledWith(admin.id, 'print_group_moved', {
      from_status: 'up_next',
      to_status: 'in_progress',
      item_count: 2,
      copy_count: 3,
    })
  })

  it('keeps tags attached when copies move individually', async () => {
    const id = await request()
    await service.createGroup({ name: 'Reserved plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1 }, admin)

    expect((await repository.listGroups())[0].items).toEqual([{ requestId: id, status: 'up_next', count: 1, order: 0 }])
  })

  it('keeps tags attached when grouped copies return to the queue', async () => {
    const id = await request()
    const groupId = await service.createGroup({ name: 'Reserved plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
    await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1, tagIds: [groupId] }, admin)

    await service.moveCopies({ id, from: 'up_next', to: 'todo', count: 1, tagIds: [groupId] }, admin)

    expect((await repository.getGroup(groupId))?.items).toEqual([{ requestId: id, status: 'todo', count: 1, order: 0 }])
  })

  it('moves untagged copies without moving tagged copies', async () => {
    const id = await repository.createRequest({
      name: 'Split stack',
      fileName: 'split.stl',
      filePath: 'todo/split.stl',
      quantity: 4,
      ownerUserId: admin.id,
    })
    const groupId = await service.createGroup({ name: 'Plate one', status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

    await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 2, tagIds: [] }, admin)

    expect((await repository.getRequest(id))?.counts).toMatchObject({ todo: 2, up_next: 2 })
    expect((await repository.getGroup(groupId))?.items).toEqual([{ requestId: id, status: 'todo', count: 2, order: 0 }])
  })

  it('assigns the next available default group name', async () => {
    const first = await service.createGroup({ status: 'todo', items: [] }, admin)
    const second = await service.createGroup({ status: 'up_next', items: [] }, admin)

    expect([(await repository.getGroup(first))?.name, (await repository.getGroup(second))?.name]).toEqual(['Tag 1', 'Tag 2'])
    expect([(await repository.getGroup(first))?.color, (await repository.getGroup(second))?.color]).toEqual(['blue', 'green'])
  })

  it('uses every group color before repeating one', async () => {
    const groups: string[] = []
    for (let index = 0; index < 13; index++) groups.push(await service.createGroup({ status: 'todo', items: [] }, admin))
    const colors = await Promise.all(groups.map(async (id) => (await repository.getGroup(id))?.color))

    expect(new Set(colors.slice(0, 12))).toHaveLength(12)
    expect(colors[12]).toBe(colors[0])
  })

  describe('tag name uniqueness', () => {
    it('rejects creating a tag whose name already exists in another case', async () => {
      await service.createGroup({ name: 'Plate', status: 'todo', items: [] }, admin)

      await expect(service.createGroup({ name: 'PLATE', status: 'todo', items: [] }, admin)).rejects.toMatchObject({ status: 409 })
    })

    it('rejects a duplicate name under the same parent', async () => {
      const parent = await service.createGroup({ name: 'Build plates', status: 'todo', items: [] }, admin)
      await service.createGroup({ name: 'Plate', parentId: parent, status: 'todo', items: [] }, admin)

      await expect(service.createGroup({ name: 'plate', parentId: parent, status: 'todo', items: [] }, admin)).rejects.toMatchObject({
        status: 409,
      })
    })

    it('allows the same name under a different parent', async () => {
      const parent = await service.createGroup({ name: 'Build plates', status: 'todo', items: [] }, admin)
      await service.createGroup({ name: 'Plate', status: 'todo', items: [] }, admin)

      await expect(service.createGroup({ name: 'plate', parentId: parent, status: 'todo', items: [] }, admin)).resolves.toBeTypeOf('string')
    })

    it('rejects moving a tag next to a tag with the same name', async () => {
      const parent = await service.createGroup({ name: 'Build plates', status: 'todo', items: [] }, admin)
      await service.createGroup({ name: 'Plate', parentId: parent, status: 'todo', items: [] }, admin)
      const tag = await service.createGroup({ name: 'PLATE', status: 'todo', items: [] }, admin)

      await expect(service.updateGroup(tag, { name: 'PLATE', parentId: parent }, admin)).rejects.toMatchObject({ status: 409 })
    })

    it('allows the same tag name in another workspace', async () => {
      await service.createGroup({ name: 'Plate', status: 'todo', items: [] }, admin)
      await repository.database
        .insert(organization)
        .values({ id: 'other-workspace', name: 'Other', slug: 'other', createdAt: new Date() })
        .run()
      const other = await repository.scoped('other-workspace')

      await expect(other.createGroup('Plate', 'todo', 'blue', [])).resolves.toBeTypeOf('string')
    })

    it('rejects updating a tag to another tag name', async () => {
      await service.createGroup({ name: 'Plate', status: 'todo', items: [] }, admin)
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(service.updateGroup(tag, { name: 'Plate ' }, admin)).rejects.toMatchObject({ status: 409 })
    })

    it('allows changing the case of a tag name', async () => {
      const tag = await service.createGroup({ name: 'plate', status: 'todo', items: [] }, admin)

      await service.updateGroup(tag, { name: 'Plate' }, admin)

      expect((await repository.getGroup(tag))?.name).toBe('Plate')
    })

    it('skips default names that exist in another case', async () => {
      await service.createGroup({ name: 'tag 2', status: 'todo', items: [] }, admin)

      const tag = await service.createGroup({ status: 'todo', items: [] }, admin)

      expect((await repository.getGroup(tag))?.name).toBe('Tag 3')
    })
  })

  it('organizes tags into a cycle-free hierarchy', async () => {
    const parent = await service.createGroup({ name: 'Build plates', status: 'todo', items: [] }, admin)
    const child = await service.createGroup({ name: 'Plate 14', parentId: parent, status: 'todo', items: [] }, admin)

    expect((await repository.getGroup(child))?.parentId).toBe(parent)
    await expect(service.updateGroup(parent, { parentId: child }, admin)).rejects.toMatchObject({ status: 409 })
  })

  it('moves overlapping tags with their copies', async () => {
    const id = await request()
    await service.createGroup({ name: 'Plate 14', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
    await service.createGroup({ name: 'Space Marines', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1 }, admin)

    expect((await repository.listGroups()).map((tag) => tag.items[0].status)).toEqual(['up_next', 'up_next'])
  })

  it('allows the same copies to carry multiple tags', async () => {
    const id = await request()
    const group = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    const second = await service.createGroup({ name: 'Needs painting', status: 'todo', items: [] }, admin)
    await service.updateCopyTags({ addTagIds: [second], removeTagIds: [], items: [{ requestId: id, status: 'todo', count: 1 }] }, admin)

    expect((await repository.getGroup(group))?.items).toHaveLength(1)
    expect((await repository.getGroup(second))?.items).toHaveLength(1)
  })

  it('removes a tag without deleting it or the print', async () => {
    const id = await request()
    const group = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.updateCopyTags({ addTagIds: [], removeTagIds: [group], items: [{ requestId: id, status: 'todo', count: 1 }] }, admin)

    expect((await repository.getGroup(group))?.items).toEqual([])
    expect(await repository.getRequest(id)).toBeDefined()
  })

  describe('updating tags on selected copies', () => {
    async function requestInTwoStages() {
      const id = await repository.createRequest({
        name: 'Split model',
        fileName: 'split.stl',
        filePath: 'split.stl',
        quantity: 2,
        ownerUserId: requester.id,
      })
      await repository.moveCopies({ id, from: 'todo', to: 'up_next', count: 1 })
      return id
    }

    it('adds a tag to copies in several stages at once', async () => {
      const first = await request()
      const second = await requestInTwoStages()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await service.updateCopyTags(
        {
          addTagIds: [tag],
          removeTagIds: [],
          items: [
            { requestId: first, status: 'todo', count: 1 },
            { requestId: second, status: 'up_next', count: 1 },
          ],
        },
        admin,
      )

      expect(new Set((await repository.getGroup(tag))?.items.map(({ requestId, status }) => `${requestId}:${status}`))).toEqual(
        new Set([`${first}:todo`, `${second}:up_next`]),
      )
    })

    it('removes one tag and adds another in the same edit', async () => {
      const id = await requestInTwoStages()
      const old = await service.createGroup({ name: 'Old', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
      const replacement = await service.createGroup({ name: 'New', status: 'todo', items: [] }, admin)

      await service.updateCopyTags(
        {
          addTagIds: [replacement],
          removeTagIds: [old],
          items: [
            { requestId: id, status: 'todo', count: 1 },
            { requestId: id, status: 'up_next', count: 1 },
          ],
        },
        admin,
      )

      expect([(await repository.getGroup(old))?.items.length, (await repository.getGroup(replacement))?.items.length]).toEqual([0, 2])
    })

    async function requestWithCopies(quantity: number) {
      return await repository.createRequest({
        name: 'Stacked model',
        fileName: 'stacked.stl',
        filePath: 'stacked.stl',
        quantity,
        ownerUserId: requester.id,
      })
    }

    function tagCopies(tagIds: { add?: string[]; remove?: string[] }, requestId: string, count: number) {
      return service.updateCopyTags(
        { addTagIds: tagIds.add ?? [], removeTagIds: tagIds.remove ?? [], items: [{ requestId, status: 'todo', count }] },
        admin,
      )
    }

    it('adds a tag to more copies without resetting the copies already tagged', async () => {
      const id = await requestWithCopies(4)
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

      await tagCopies({ add: [tag] }, id, 1)

      expect((await repository.getGroup(tag))?.items[0].count).toBe(3)
    })

    it('caps added tag copies at the copies in that stage', async () => {
      const id = await requestWithCopies(3)
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

      await tagCopies({ add: [tag] }, id, 2)

      expect((await repository.getGroup(tag))?.items[0].count).toBe(3)
    })

    it('removes a tag from only the selected copies', async () => {
      const id = await requestWithCopies(3)
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [{ requestId: id, count: 3 }] }, admin)

      await tagCopies({ remove: [tag] }, id, 1)

      expect((await repository.getGroup(tag))?.items[0].count).toBe(2)
    })

    it('removes the tag from the print once every tagged copy is deselected', async () => {
      const id = await requestWithCopies(3)
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

      await tagCopies({ remove: [tag] }, id, 2)

      expect((await repository.getGroup(tag))?.items).toEqual([])
    })

    it('rejects creating a tag whose name already exists in another case', async () => {
      const id = await request()
      await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags(
          { createTagName: ' batch ', addTagIds: [], removeTagIds: [], items: [{ requestId: id, status: 'todo', count: 1 }] },
          admin,
        ),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('leaves existing tags untouched when the new tag name is taken', async () => {
      const id = await request()
      await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)
      const other = await service.createGroup({ name: 'Other', status: 'todo', items: [] }, admin)

      await service
        .updateCopyTags(
          { createTagName: 'BATCH', addTagIds: [other], removeTagIds: [], items: [{ requestId: id, status: 'todo', count: 1 }] },
          admin,
        )
        .catch(() => undefined)

      expect([(await repository.listGroups()).length, (await repository.getGroup(other))?.items]).toEqual([2, []])
    })

    it('changes nothing when one selected copy is no longer in its stage', async () => {
      const first = await request()
      const second = await requestInTwoStages()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags(
          {
            addTagIds: [tag],
            removeTagIds: [],
            items: [
              { requestId: first, status: 'todo', count: 1 },
              { requestId: second, status: 'done', count: 1 },
            ],
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 409 })
      expect((await repository.getGroup(tag))?.items).toEqual([])
    })

    it('creates a new tag on copies in several stages at once', async () => {
      const id = await requestInTwoStages()

      const tag = await service.updateCopyTags(
        {
          createTagName: 'Fresh batch',
          addTagIds: [],
          removeTagIds: [],
          items: [
            { requestId: id, status: 'todo', count: 1 },
            { requestId: id, status: 'up_next', count: 1 },
          ],
        },
        admin,
      )

      const created = await repository.getGroup(tag!)
      expect([created?.name, created?.items.map(({ status }) => status).sort()]).toEqual(['Fresh batch', ['todo', 'up_next']])
    })

    it('leaves no new tag behind when applying it fails partway', async () => {
      const first = await request()
      const second = await requestInTwoStages()
      const getRequest = repository.getRequest.bind(repository)
      // Copies leave a stage after the service validated them, so the repository rejects the second item mid-transaction.
      vi.spyOn(repository, 'getRequest').mockImplementation(async (requestId) => {
        const found = await getRequest(requestId)
        return found && requestId === second ? { ...found, counts: { ...found.counts, done: 1 } } : found
      })

      await expect(
        service.updateCopyTags(
          {
            createTagName: 'Fresh batch',
            addTagIds: [],
            removeTagIds: [],
            items: [
              { requestId: first, status: 'todo', count: 1 },
              { requestId: second, status: 'done', count: 1 },
            ],
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 409 })
      expect(await repository.listGroups()).toEqual([])
    })

    it('changes nothing when a tag no longer exists', async () => {
      const id = await request()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags(
          { addTagIds: [tag, 'missing-tag'], removeTagIds: [], items: [{ requestId: id, status: 'todo', count: 1 }] },
          admin,
        ),
      ).rejects.toMatchObject({ status: 404 })
      expect((await repository.getGroup(tag))?.items).toEqual([])
    })

    it('rejects an edit that adds and removes the same tag', async () => {
      const id = await request()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags({ addTagIds: [tag], removeTagIds: [tag], items: [{ requestId: id, status: 'todo', count: 1 }] }, admin),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects a selection that lists the same copies twice', async () => {
      const id = await request()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags(
          {
            addTagIds: [tag],
            removeTagIds: [],
            items: [
              { requestId: id, status: 'todo', count: 1 },
              { requestId: id, status: 'todo', count: 1 },
            ],
          },
          admin,
        ),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('does not let requesters edit tags', async () => {
      const id = await request()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)

      await expect(
        service.updateCopyTags({ addTagIds: [tag], removeTagIds: [], items: [{ requestId: id, status: 'todo', count: 1 }] }, requester),
      ).rejects.toMatchObject({ status: 403 })
    })

    it('publishes one board change and records the edit size', async () => {
      const publish = vi.fn()
      service = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
      const id = await requestInTwoStages()
      const tag = await service.createGroup({ name: 'Batch', status: 'todo', items: [] }, admin)
      publish.mockClear()
      capture.mockClear()

      await service.updateCopyTags(
        {
          addTagIds: [tag],
          removeTagIds: [],
          items: [
            { requestId: id, status: 'todo', count: 1 },
            { requestId: id, status: 'up_next', count: 1 },
          ],
        },
        admin,
      )

      expect([publish.mock.calls, capture.mock.calls]).toEqual([
        [['board.changed']],
        [
          [
            admin.id,
            'print_copy_tags_updated',
            { item_count: 2, status_count: 2, added_tag_count: 1, removed_tag_count: 0, created_tag: false },
          ],
        ],
      ])
    })
  })

  it('clamps tag assignments when request quantity is reduced', async () => {
    const id = await repository.createRequest({
      name: 'Grouped model',
      fileName: 'grouped.stl',
      filePath: 'grouped.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

    await service.update(id, { quantity: 1 }, requester)

    expect((await repository.getRequest(id))?.quantity).toBe(1)
    expect((await repository.listGroups())[0].items[0].count).toBe(1)
  })

  it('renames and deletes a group without deleting its prints', async () => {
    const id = await request()
    capture.mockClear()
    const group = await service.createGroup({ name: 'Original plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await service.updateGroup(group, { name: 'Updated plate' }, admin)
    expect((await repository.getGroup(group))?.name).toBe('Updated plate')

    await service.deleteGroup(group, admin)
    expect(await repository.getGroup(group)).toBeUndefined()
    expect((await repository.getRequest(id))?.counts.todo).toBe(1)
    expect(capture.mock.calls).toEqual([
      [admin.id, 'print_group_created', { item_count: 1, copy_count: 1 }],
      [admin.id, 'print_group_deleted', { item_count: 1, copy_count: 1 }],
    ])
  })

  it('reorders prints inside a group', async () => {
    const first = await request()
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const group = await service.createGroup(
      {
        name: 'Ordered plate',
        status: 'todo',
        items: [
          { requestId: first, count: 1 },
          { requestId: second, count: 1 },
        ],
      },
      admin,
    )

    await service.reorderGroupItem(group, 'todo', second, first, 'before', admin)

    expect((await repository.getGroup(group))?.items.map((item) => item.requestId)).toEqual([second, first])
  })

  it('leaves every request unchanged when any batch move is invalid', async () => {
    const first = await request()
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })

    await expect(
      service.moveCopiesBatch(
        [
          { id: first, from: 'todo', to: 'up_next', count: 1 },
          { id: second, from: 'todo', to: 'up_next', count: 2 },
        ],
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect((await repository.getRequest(first))?.counts).toMatchObject({ todo: 1, up_next: 0 })
  })

  it('rolls staged assets back when the batch database commit fails', async () => {
    const id = await request()
    vi.spyOn(repository, 'moveCopiesBatch').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], admin)).rejects.toThrow('database unavailable')
    expect(await assets.exists('todo/model.stl')).toBe(true)
    expect((await repository.getRequest(id))?.counts).toMatchObject({ todo: 1, done: 0 })
  })

  it('requires an administrator for batch moves and deletion', async () => {
    const id = await request()
    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], requester)).rejects.toMatchObject({
      status: 403,
    })
    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], requester)).rejects.toMatchObject({ status: 403 })
  })

  it('cannot batch-mutate requests from another workspace', async () => {
    await repository.listRequests()
    await repository.database
      .insert(organization)
      .values({ id: 'other-workspace', name: 'Other', slug: 'other', createdAt: new Date() })
      .run()
    const other = await repository.scoped('other-workspace')
    const id = await other.createRequest({
      name: 'Other',
      fileName: 'other.stl',
      filePath: 'todo/other.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })

    await expect(service.moveCopiesBatch([{ id, from: 'todo', to: 'done', count: 1 }], admin)).rejects.toMatchObject({ status: 404 })
    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).rejects.toMatchObject({ status: 404 })
    expect(await other.getRequest(id)).toBeTruthy()
  })

  it('deletes a complete request batch', async () => {
    const first = await request()
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })

    capture.mockClear()
    await service.removeCopiesBatch(
      [
        { id: first, status: 'todo', count: 1 },
        { id: second, status: 'todo', count: 2 },
      ],
      admin,
    )

    expect(await repository.listRequests()).toHaveLength(0)
    expect(capture).toHaveBeenCalledWith(admin.id, 'request_batch_deleted', {
      request_count: 2,
      copy_count: 3,
      deleted_request_count: 2,
      from_statuses: ['todo'],
      print_types: [],
    })
  })

  it('deletes copies from a print group', async () => {
    const id = await repository.createRequest({
      name: 'Grouped model',
      fileName: 'grouped.stl',
      filePath: 'todo/grouped.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [groupId] }], admin)

    expect(await repository.getRequest(id)).toMatchObject({ quantity: 2, counts: { todo: 2 } })
    expect((await repository.getGroup(groupId))?.items).toEqual([{ requestId: id, status: 'todo', count: 1, order: 0 }])
  })

  it('deletes untagged copies without removing tags from tagged copies in the stage', async () => {
    const id = await repository.createRequest({
      name: 'Partly tagged model',
      fileName: 'partly-tagged.stl',
      filePath: 'todo/partly-tagged.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)

    expect((await repository.getGroup(groupId))?.items).toEqual([{ requestId: id, status: 'todo', count: 2, order: 0 }])
  })

  it('deletes tagged copies from only the stage of the deleted card', async () => {
    const id = await repository.createRequest({
      name: 'Spread model',
      fileName: 'spread.stl',
      filePath: 'todo/spread.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, tagIds: [groupId] }, admin)

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [groupId] }], admin)

    expect((await repository.getGroup(groupId))?.items).toMatchObject([{ status: 'in_progress', count: 1 }])
  })

  it('deletes tagged copies from a stage other than the one the tag was created in', async () => {
    const id = await repository.createRequest({
      name: 'Moved tagged model',
      fileName: 'moved-tagged.stl',
      filePath: 'todo/moved-tagged.stl',
      quantity: 2,
      ownerUserId: requester.id,
    })
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 2 }] }, admin)
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 1, tagIds: [groupId] }, admin)

    await service.removeCopiesBatch([{ id, status: 'in_progress', count: 1, tagIds: [groupId] }], admin)

    expect((await repository.getGroup(groupId))?.items).toMatchObject([{ status: 'todo', count: 1 }])
  })

  /** Two To do copies tagged A, one also tagged B and the other also C, so the board draws the cards {A, B} and {A, C}. */
  async function twoMultiTagCards(quantity = 2) {
    const id = await repository.createRequest({
      name: 'Multi-tag model',
      fileName: 'multi-tag.stl',
      filePath: 'todo/multi-tag.stl',
      quantity,
      ownerUserId: requester.id,
    })
    if (quantity > 2) await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: quantity - 2 }, admin)
    const tag = (count: number) => service.createGroup({ status: 'todo', items: [{ requestId: id, count }] }, admin)
    const a = await tag(2)
    const b = await tag(1)
    const c = await tag(1)
    const tagCounts = async () => Promise.all([a, b, c].map(async (tagId) => (await repository.getGroup(tagId))?.items[0]?.count ?? 0))
    return { id, a, b, c, tagCounts }
  }

  it('deletes a multi-tag card without removing tags from another multi-tag card of the print', async () => {
    const { id, a, b, tagCounts } = await twoMultiTagCards()

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [a, b] }], admin)

    expect(await tagCounts()).toEqual([1, 0, 1])
  })

  it('deletes two cards of the same print in one stage in one batch', async () => {
    const { id, a, b, c, tagCounts } = await twoMultiTagCards(3)

    await service.removeCopiesBatch(
      [
        { id, status: 'todo', count: 1, tagIds: [a, b] },
        { id, status: 'todo', count: 1, tagIds: [c, a] },
      ],
      admin,
    )

    expect([(await repository.getRequest(id))?.counts, await tagCounts()]).toMatchObject([{ todo: 0, in_progress: 1 }, [0, 0, 0]])
  })

  it('deletes the request once when a batch removes every card of the print', async () => {
    const { id, a, b, c } = await twoMultiTagCards()
    capture.mockClear()

    await service.removeCopiesBatch(
      [
        { id, status: 'todo', count: 1, tagIds: [a, b] },
        { id, status: 'todo', count: 1, tagIds: [a, c] },
      ],
      admin,
    )

    expect([await repository.getRequest(id), capture.mock.calls.filter((call: unknown[]) => call[1] === 'request_deleted').length]).toEqual(
      [undefined, 1],
    )
  })

  it('deletes nothing when a batch names copies the stage does not have', async () => {
    const { id, a, b, c, tagCounts } = await twoMultiTagCards(3)

    await expect(
      service.removeCopiesBatch(
        [
          { id, status: 'todo', count: 1, tagIds: [a, b] },
          { id, status: 'todo', count: 1, tagIds: [b, c] },
        ],
        admin,
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect([(await repository.getRequest(id))?.counts.todo, await tagCounts()]).toEqual([2, [2, 1, 1]])
  })

  it('rejects a batch naming the same card twice', async () => {
    const { id, a, b } = await twoMultiTagCards(3)

    await expect(
      service.removeCopiesBatch(
        [
          { id, status: 'todo', count: 1, tagIds: [a, b] },
          { id, status: 'todo', count: 1, tagIds: [b, a] },
        ],
        admin,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a deletion naming a tag twice', async () => {
    const id = await request()
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1, tagIds: [groupId, groupId] }], admin)).rejects.toMatchObject({
      status: 400,
    })
  })

  /** Each tag's copy count per stage, in the order the tags were created. */
  async function tagStages(tagIds: string[]) {
    return Promise.all(
      tagIds.map(async (tagId) =>
        Object.fromEntries(((await repository.getGroup(tagId))?.items ?? []).map(({ status, count }) => [status, count])),
      ),
    )
  }

  it('moves a multi-tag card without moving the tags of another multi-tag card of the print', async () => {
    const { id, a, b, c } = await twoMultiTagCards()

    await service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1, tagIds: [a, b] }, admin)

    expect(await tagStages([a, b, c])).toEqual([{ todo: 1, up_next: 1 }, { up_next: 1 }, { todo: 1 }])
  })

  it('moves two cards of the same print in one batch', async () => {
    const { id, a, b, c } = await twoMultiTagCards()
    capture.mockClear()

    await service.moveCopiesBatch(
      [
        { id, from: 'todo', to: 'up_next', count: 1, tagIds: [a, b] },
        { id, from: 'todo', to: 'in_progress', count: 1, tagIds: [c, a] },
      ],
      admin,
    )

    expect([
      await tagStages([a, b, c]),
      (capture.mock.calls.find((call: unknown[]) => call[1] === 'request_batch_moved') as unknown[] | undefined)?.[2],
    ]).toMatchObject([[{ up_next: 1, in_progress: 1 }, { up_next: 1 }, { in_progress: 1 }], { request_count: 1, copy_count: 2 }])
  })

  it('moves nothing when a card has changed since the board drew it', async () => {
    const { id, b, c, tagCounts } = await twoMultiTagCards()

    await expect(service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1, tagIds: [b, c] }, admin)).rejects.toMatchObject({
      status: 409,
    })
    expect([(await repository.getRequest(id))?.counts.todo, await tagCounts()]).toEqual([2, [2, 1, 1]])
  })

  it('rejects a batch moving the same card twice', async () => {
    const { id, a, b } = await twoMultiTagCards(3)

    await expect(
      service.moveCopiesBatch(
        [
          { id, from: 'todo', to: 'up_next', count: 1, tagIds: [a, b] },
          { id, from: 'todo', to: 'done', count: 1, tagIds: [b, a] },
        ],
        admin,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a move naming a tag twice', async () => {
    const id = await request()
    const groupId = await service.createGroup({ status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)

    await expect(
      service.moveCopies({ id, from: 'todo', to: 'up_next', count: 1, tagIds: [groupId, groupId] }, admin),
    ).rejects.toMatchObject({
      status: 400,
    })
  })

  it('moves a whole tag with the other tags its copies carry', async () => {
    const { a, b, c } = await twoMultiTagCards()

    await service.moveGroup(a, 'todo', 'up_next', admin)

    expect(await tagStages([a, b, c])).toEqual([{ up_next: 2 }, { up_next: 1 }, { up_next: 1 }])
  })

  it('does not wait for permanent trash cleanup before completing a batch deletion', async () => {
    const id = await request()
    let startCleanup: (() => void) | undefined
    const cleanupStarted = new Promise<void>((resolve) => (startCleanup = resolve))
    vi.spyOn(assets, 'purgeTrash').mockImplementation(async () => {
      startCleanup?.()
      await new Promise(() => undefined)
    })

    await service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)

    await cleanupStarted
    expect(await repository.getRequest(id)).toBeUndefined()
  })

  it('stages batch assets concurrently', async () => {
    const first = await request()
    await assets.write('todo/second.stl', new TextEncoder().encode('second'))
    const second = await repository.createRequest({
      name: 'Second',
      fileName: 'second.stl',
      filePath: 'todo/second.stl',
      quantity: 1,
      ownerUserId: requester.id,
    })
    const ensureMoved = vi.spyOn(assets, 'ensureMoved')
    let releaseMoves: (() => void) | undefined
    const movesReleased = new Promise<void>((resolve) => (releaseMoves = resolve))
    ensureMoved.mockImplementation(async () => movesReleased)

    const deletion = service.removeCopiesBatch(
      [
        { id: first, status: 'todo', count: 1 },
        { id: second, status: 'todo', count: 1 },
      ],
      admin,
    )
    await vi.waitFor(() => expect(ensureMoved).toHaveBeenCalledTimes(2))
    releaseMoves?.()
    await deletion
  })

  it('restores every asset when a batch deletion cannot commit', async () => {
    const id = await request()
    vi.spyOn(repository, 'deleteCopiesBatch').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).rejects.toThrow('database unavailable')
    expect(await repository.getRequest(id)).toBeTruthy()
    expect(await assets.exists('todo/model.stl')).toBe(true)
  })

  it('deletes only copies in the selected stage', async () => {
    await assets.write('todo/split.stl', new TextEncoder().encode('split'))
    const id = await repository.createRequest({
      name: 'Split',
      fileName: 'split.stl',
      filePath: 'todo/split.stl',
      quantity: 3,
      ownerUserId: requester.id,
    })
    await service.moveCopies({ id, from: 'todo', to: 'in_progress', count: 2 }, admin)

    await service.removeCopiesBatch([{ id, status: 'in_progress', count: 2 }], admin)

    expect(await repository.getRequest(id)).toMatchObject({ quantity: 1, counts: { todo: 1, in_progress: 0 } })
    expect(await assets.exists('todo/split.stl')).toBe(true)
  })

  it('deletes copies without a raw error when the model file is already gone from storage', async () => {
    const id = await request()
    await assets.remove('todo/model.stl')

    await expect(service.removeCopiesBatch([{ id, status: 'todo', count: 1 }], admin)).resolves.toBeUndefined()

    expect(await repository.getRequest(id)).toBeUndefined()
    expect(await repository.listOperations()).toHaveLength(0)
  })

  it('completes a pending move without a raw error when the model file is already gone from storage', async () => {
    const id = await request()
    await assets.remove('todo/model.stl')
    await repository.beginOperation(crypto.randomUUID(), {
      kind: 'move',
      requestId: id,
      fromStatus: 'todo',
      toStatus: 'in_progress',
      count: 1,
      sourcePath: 'todo/model.stl',
      destinationPath: 'in-progress/model.stl',
    })

    await expect(service.recoverOperations()).resolves.toBeUndefined()

    expect(await repository.listOperations()).toHaveLength(0)
    expect(await repository.getRequest(id)).toMatchObject({ counts: { todo: 0, in_progress: 1 } })
  })

  describe('inventory', () => {
    const grey: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
    const wash: EquipmentItem = {
      id: 'wash',
      name: 'Wash',
      kind: 'wash',
      stage: 'finishing',
      powerWatts: 50,
      minutesPerUse: 10,
      supplies: [],
    }
    let publish: Mock<EventBus['publish']>
    let inventory: STLQuestService

    beforeEach(() => {
      publish = vi.fn()
      inventory = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
      capture.mockClear()
    })

    it('lets only admins change it', async () => {
      await stock('consumables', [grey])

      await expect(
        Promise.allSettled([
          inventory.createInventoryItem('printers', slaPrinter, requester),
          inventory.updateInventoryItem('consumables', { ...grey, name: 'Renamed' }, requester),
          inventory.setInventoryItemArchived('consumables', grey.id, true, requester),
          inventory.skipPrinterSetup(requester),
        ]),
      ).resolves.toEqual(Array.from({ length: 4 }, () => ({ status: 'rejected', reason: expect.objectContaining({ status: 403 }) })))
      expect(await repository.listInventory('consumables')).toEqual([grey])
    })

    it('adds an item after the others and announces the change', async () => {
      await stock('printers', [slaPrinter])

      await inventory.createInventoryItem('printers', filamentPrinter, admin)

      expect({
        printers: (await repository.listInventory('printers')).map(({ id }) => id),
        published: publish.mock.calls,
      }).toEqual({ printers: [slaPrinter.id, filamentPrinter.id], published: [['inventory.changed']] })
    })

    it('refuses an item whose ID is already stored', async () => {
      await stock('consumables', [grey])

      await expect(inventory.createInventoryItem('consumables', { ...grey, name: 'Again' }, admin)).rejects.toMatchObject({ status: 409 })
    })

    it('refuses an edit to an item the workspace does not have', async () => {
      await expect(inventory.updateInventoryItem('equipment', wash, admin)).rejects.toMatchObject({ status: 404 })
    })

    it('keeps an item archived when it is edited', async () => {
      await stock('equipment', [{ ...wash, archived: true }])

      await inventory.updateInventoryItem('equipment', { ...wash, minutesPerUse: 20 }, admin)

      expect(await repository.listInventory('equipment')).toEqual([{ ...wash, minutesPerUse: 20, archived: true }])
    })

    it('refuses a printer named like another active printer', async () => {
      await stock('printers', [slaPrinter])

      await expect(
        inventory.createInventoryItem('printers', { ...filamentPrinter, name: slaPrinter.name.toUpperCase() }, admin),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('limits the items in use, not the archived ones', async () => {
      await stock(
        'equipment',
        Array.from({ length: MAX_EQUIPMENT }, (_, index) => ({ ...wash, id: `wash-${index}` })),
      )
      await expect(inventory.createInventoryItem('equipment', wash, admin)).rejects.toMatchObject({ status: 409 })

      await inventory.setInventoryItemArchived('equipment', 'wash-0', true, admin)
      await inventory.createInventoryItem('equipment', wash, admin)

      expect(await repository.listInventory('equipment')).toHaveLength(MAX_EQUIPMENT + 1)
    })

    it('archives a consumable without losing the usage and spend that name it', async () => {
      await stock('consumables', [grey])
      await repository.setSetting(USAGE_TRACKING_SETTING, true)
      await inventory.recordStockMovement({ consumableId: grey.id, kind: 'waste', amount: 100 }, admin)

      await inventory.setInventoryItemArchived('consumables', grey.id, true, admin)

      const library = await repository.listInventory('consumables')
      expect({
        library,
        pricing: consumablesOfKind(library, 'resin'),
        spend: summariseSpend(await inventory.listUsage({}, admin), library, DEFAULT_PRICE_CALCULATOR_SETTINGS.currency).items,
      }).toEqual({
        library: [{ ...grey, archived: true }],
        pricing: [],
        spend: [expect.objectContaining({ category: 'material', id: grey.id, amount: 100 })],
      })
    })

    it('keeps each workspace to its own items', async () => {
      await stock('consumables', [grey])
      const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
      const otherService = new STLQuestService(other, assets, staging, { publish }, telemetry, { remove: removeTusUpload })

      await expect(otherService.updateInventoryItem('consumables', { ...grey, name: 'Taken' }, admin)).rejects.toMatchObject({
        status: 404,
      })
      await otherService.createInventoryItem('consumables', { ...grey, name: 'Their grey' }, admin)

      expect([(await repository.listInventory('consumables'))[0].name, (await other.listInventory('consumables'))[0].name]).toEqual([
        'Grey',
        'Their grey',
      ])
    })

    it('reports each save with the counts it always has', async () => {
      await inventory.createInventoryItem('printers', slaPrinter, admin)
      await inventory.setInventoryItemArchived('printers', slaPrinter.id, true, admin)
      await inventory.createInventoryItem('consumables', grey, admin)
      await inventory.createInventoryItem('equipment', { ...wash, presetId: 'formlabs-form-wash' }, admin)
      await inventory.createInventoryItem('stores', { id: 'bambu', name: 'Bambu Lab EU', freeShippingOver: 55 }, admin)

      expect(capture.mock.calls).toEqual([
        [admin.id, 'printer_saved', { printer_count: 1, added_count: 1, updated_count: 0, removed_count: 0 }],
        [admin.id, 'printer_saved', { printer_count: 0, added_count: 0, updated_count: 0, removed_count: 1 }],
        [
          admin.id,
          'consumables_saved',
          { resin_count: 1, filament_count: 0, part_count: 0, supply_count: 0, catalogue_supply_count: 0, with_store_count: 0 },
        ],
        [admin.id, 'equipment_saved', { equipment_count: 1, catalogue_count: 1, with_supplies_count: 0 }],
        [
          admin.id,
          'stores_saved',
          {
            store_count: 1,
            with_shipping_count: 0,
            with_free_shipping_count: 1,
            with_currency_count: 0,
            with_usual_order_count: 0,
            with_url_count: 0,
          },
        ],
      ])
    })

    describe('adding several consumables', () => {
      const pla = { kind: 'filament', filamentPresetId: 'bambu-pla', pricePerKg: 24 } as const
      const black: Consumable = { ...pla, id: 'black', name: 'PLA · Black', colour: { name: 'Black', hex: '#000000' } }
      const white: Consumable = { ...pla, id: 'white', name: 'PLA · White', colour: { name: 'White', hex: '#ffffff' } }

      it('adds them after the others and announces the change once', async () => {
        await stock('consumables', [grey])

        await inventory.createConsumables([black, white], undefined, admin)

        expect({
          library: (await repository.listInventory('consumables')).map(({ id }) => id),
          published: publish.mock.calls,
        }).toEqual({ library: [grey.id, black.id, white.id], published: [['inventory.changed']] })
      })

      it('keeps one already stored, as a retried add left it, and adds the rest', async () => {
        await stock('consumables', [{ ...white, pricePerKg: 30 }])

        await inventory.createConsumables([black, white], undefined, admin)

        expect((await repository.listInventory('consumables')).map((item) => ({ id: item.id, pricePerKg: consumablePrice(item) }))).toEqual(
          [
            { id: white.id, pricePerKg: 30 },
            { id: black.id, pricePerKg: 24 },
          ],
        )
      })

      it('counts stock once when the same add is retried', async () => {
        await repository.setSetting(USAGE_TRACKING_SETTING, true)
        await inventory.createConsumables([black, white], 1_000, admin)

        await inventory.createConsumables([black, white], 1_000, admin)

        expect((await inventory.stockLevels(admin)).map(({ onHand }) => onHand)).toEqual([1_000, 1_000])
      })

      it('adds none when they would pass the limit', async () => {
        await stock(
          'consumables',
          Array.from({ length: MAX_CONSUMABLES - 1 }, (_, index) => ({ ...grey, id: `grey-${index}` })),
        )

        await expect(inventory.createConsumables([black, white], undefined, admin)).rejects.toMatchObject({ status: 409 })
        expect(await repository.listInventory('consumables')).toHaveLength(MAX_CONSUMABLES - 1)
      })

      it('counts each at the amount on hand while stock is tracked', async () => {
        await repository.setSetting(USAGE_TRACKING_SETTING, true)

        await inventory.createConsumables([black, white], 1_000, admin)

        expect((await inventory.stockLevels(admin)).map(({ onHand, tracked }) => ({ onHand, tracked }))).toEqual([
          { onHand: 1_000, tracked: true },
          { onHand: 1_000, tracked: true },
        ])
      })

      it('counts them in one step that undoes together', async () => {
        await repository.setSetting(USAGE_TRACKING_SETTING, true)
        await inventory.createConsumables([black, white], 1_000, admin)
        const [{ transactionId }] = await inventory.listUsage({}, admin)

        await inventory.undoUsage(transactionId, admin)

        expect((await inventory.stockLevels(admin)).map(({ tracked }) => tracked)).toEqual([false, false])
      })

      it('refuses an amount on hand while stock is not tracked, adding nothing', async () => {
        await expect(inventory.createConsumables([black], 1_000, admin)).rejects.toMatchObject({ status: 409 })
        expect(await repository.listInventory('consumables')).toEqual([])
      })

      it('lets only admins add them', async () => {
        await expect(inventory.createConsumables([black], undefined, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('reports how many were added and whether they were counted', async () => {
        await inventory.createConsumables([black, white], undefined, admin)

        expect(capture.mock.calls.at(-1)).toEqual([
          admin.id,
          'consumables_added',
          { item_count: 2, consumable_kind: 'filament', has_stock: false },
        ])
      })
    })

    describe('sharing a filament price', () => {
      const pla = { kind: 'filament', filamentPresetId: 'bambu-pla' } as const
      const black: Consumable = { ...pla, id: 'black', name: 'PLA · Black', pricePerKg: 26 }
      const white: Consumable = { ...pla, id: 'white', name: 'PLA · White', pricePerKg: 20 }
      const petg: Consumable = { kind: 'filament', id: 'petg', name: 'PETG', filamentPresetId: 'bambu-petg', pricePerKg: 20 }

      it('gives the other colours of the product its price', async () => {
        await stock('consumables', [black, white, petg])

        await inventory.shareFilamentPrice(black.id, admin)

        expect((await repository.listInventory('consumables')).map((item) => item.kind === 'filament' && item.pricePerKg)).toEqual([
          26, 26, 20,
        ])
      })

      it('refuses a consumable that is not a filament', async () => {
        await stock('consumables', [grey])

        await expect(inventory.shareFilamentPrice(grey.id, admin)).rejects.toMatchObject({ status: 404 })
      })

      it('lets only admins share it', async () => {
        await stock('consumables', [black, white])

        await expect(inventory.shareFilamentPrice(black.id, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('leaves a colour priced in another currency as it is', async () => {
        await stock('stores', [{ id: 'us', name: 'US', currency: 'USD', exchangeRate: 0.9, exchangeRateCurrency: 'EUR' }])
        await stock('consumables', [black, { ...white, storeId: 'us' }])

        await inventory.shareFilamentPrice(black.id, admin)

        expect((await repository.listInventory('consumables')).map((item) => item.kind === 'filament' && item.pricePerKg)).toEqual([26, 20])
      })

      it('reports how many colours took the price', async () => {
        await stock('consumables', [black, white, petg])

        await inventory.shareFilamentPrice(black.id, admin)

        expect(capture.mock.calls.at(-1)).toEqual([admin.id, 'filament_price_shared', { colour_count: 1 }])
      })
    })

    it('counts the supplies added from the catalogue', async () => {
      await inventory.createInventoryItem(
        'consumables',
        { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 8, supplyPresetId: 'supply-isopropyl-alcohol' },
        admin,
      )

      expect(capture).toHaveBeenCalledWith(
        admin.id,
        'consumables_saved',
        expect.objectContaining({ supply_count: 1, catalogue_supply_count: 1 }),
      )
    })

    it('remembers printer setup finished without a printer', async () => {
      await inventory.skipPrinterSetup(admin)

      expect(await repository.getSetting(PRINTERS_SKIPPED_SETTING)).toBe(true)
    })
  })

  describe('usage log', () => {
    const resin: Consumable = { id: 'grey', kind: 'resin', name: 'Grey', pricePerLitre: 40, densityGramsPerMl: 1.1 }
    const filament: Consumable = { id: 'pla', kind: 'filament', name: 'PLA', pricePerKg: 20 }
    const ipa: Consumable = { id: 'ipa', kind: 'supply', name: 'IPA', unit: 'ml', price: 10, minimumStock: 500 }
    const amazon: Store = { id: 'amazon', name: 'Amazon US', currency: 'USD', exchangeRate: 0.9, exchangeRateCurrency: 'EUR' }
    const wash: EquipmentItem = {
      id: 'wash',
      name: 'Wash station',
      kind: 'wash',
      stage: 'finishing',
      powerWatts: 50,
      minutesPerUse: 10,
      supplies: [{ consumableId: ipa.id, amountPerUse: 20 }],
    }

    async function estimatedPrint() {
      const id = await request()
      await repository.updateRequest(id, { printerId: slaPrinter.id, estimatedMaterialOverride: 12, estimatedPrintMinutesOverride: 90 })
      return id
    }

    beforeEach(async () => {
      await stock('printers', [slaPrinter])
      await stock('consumables', [resin, filament, ipa])
      await stock('equipment', [wash])
      await repository.setSetting(USAGE_TRACKING_SETTING, true)
    })

    describe('deleting an item', () => {
      const tank: Consumable = {
        id: 'tank',
        kind: 'part',
        name: 'Tank',
        printType: 'resin',
        price: 100,
        lifespan: 100,
        lifespanUnit: 'plates',
        printerId: slaPrinter.id,
      }

      async function archive(kind: InventoryKind, id: string) {
        await service.setInventoryItemArchived(kind, id, true, admin)
      }

      it('refuses an item still in use', async () => {
        await expect(service.deleteInventoryItem('printers', slaPrinter.id, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('keeps an item it refuses to delete', async () => {
        await service.deleteInventoryItem('printers', slaPrinter.id, admin).catch(() => undefined)

        expect((await repository.listInventory('printers')).map(({ id }) => id)).toEqual([slaPrinter.id])
      })

      it('lets only admins delete', async () => {
        await archive('consumables', ipa.id)

        await expect(service.deleteInventoryItem('consumables', ipa.id, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('lets only admins count what names an item', async () => {
        await expect(service.inventoryReferences('consumables', ipa.id, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('refuses an item the workspace does not have', async () => {
        await expect(service.deleteInventoryItem('equipment', 'missing', admin)).rejects.toMatchObject({ status: 404 })
      })

      it('counts what names a printer', async () => {
        await stock('consumables', [tank])
        const requestId = await estimatedPrint()
        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)

        expect(await service.inventoryReferences('printers', slaPrinter.id, admin)).toEqual({
          requests: 1,
          plates: 0,
          usage: 3,
          stock: 0,
          supplies: 0,
          parts: 1,
          bought: 0,
        })
      })

      it('counts what names a consumable', async () => {
        await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 500 }, admin)
        await service.recordStepUsage({ requestId: await estimatedPrint(), stage: 'finishing', copies: 1, equipmentIds: [wash.id] }, admin)

        expect(await service.inventoryReferences('consumables', ipa.id, admin)).toEqual({
          requests: 0,
          plates: 0,
          usage: 1,
          stock: 1,
          supplies: 1,
          parts: 0,
          bought: 0,
        })
      })

      it('counts the consumables bought from a store', async () => {
        await service.createInventoryItem('stores', { id: 'bambu', name: 'Bambu Lab EU' }, admin)
        await service.updateInventoryItem('consumables', { ...ipa, storeId: 'bambu' }, admin)

        expect((await service.inventoryReferences('stores', 'bambu', admin)).bought).toBe(1)
      })

      it('keeps a store’s currency, exchange rate, usual order, and website', async () => {
        const store = {
          id: 'amazon',
          name: 'Amazon US',
          currency: 'USD',
          exchangeRate: 0.9,
          exchangeRateCurrency: 'EUR',
          usualOrder: 50,
          url: 'https://www.amazon.com/',
        } as const

        await service.createInventoryItem('stores', store, admin)

        expect(await repository.listInventory('stores')).toEqual([store])
      })

      it('records stock bought from a store in the workspace currency, its shipping spread over it', async () => {
        await service.createInventoryItem('stores', { ...amazon, shippingCost: 10, usualOrder: 50 }, admin)
        await service.updateInventoryItem('consumables', { ...ipa, storeId: 'amazon' }, admin)

        const { events } = await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

        expect(events[0].unitPrice).toBeCloseTo((10 / 1_000) * 0.9 * 1.2, 9)
      })

      describe('repricing what a store sells', () => {
        const ipaPrice = async () => {
          const stored = (await repository.listInventory('consumables')).find(({ id }) => id === ipa.id)
          return stored?.kind === 'supply' ? stored.price : undefined
        }

        beforeEach(async () => {
          await service.createInventoryItem('stores', amazon, admin)
          await service.updateInventoryItem('consumables', { ...ipa, storeId: 'amazon' }, admin)
        })

        it('converts what a deleted store sold into the workspace currency', async () => {
          await archive('stores', 'amazon')

          await service.deleteInventoryItem('stores', 'amazon', admin)

          expect(await ipaPrice()).toBe(9)
        })

        it('keeps the value of what a store sells when its currency changes', async () => {
          await service.updateInventoryItem('stores', { ...amazon, currency: 'GBP', exchangeRate: 1.2 }, admin)

          expect(await ipaPrice()).toBe(7.5)
        })

        it('takes the shipping share out of a store’s prices when asked', async () => {
          await service.updateInventoryItem('stores', { ...amazon, shippingCost: 10, usualOrder: 50 }, admin, { from: 0, to: 0.2 })

          expect(await ipaPrice()).toBe(8.333)
        })

        it('keeps recorded usage as it was when a store’s currency changes', async () => {
          await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

          await service.updateInventoryItem('stores', { ...amazon, currency: 'GBP', exchangeRate: 1.2 }, admin)

          expect((await service.listUsage({}, admin))[0].unitPrice).toBeCloseTo(0.009, 9)
        })
      })

      it('leaves consumables bought from a deleted store with no store', async () => {
        await service.createInventoryItem('stores', { id: 'bambu', name: 'Bambu Lab EU' }, admin)
        await service.updateInventoryItem('consumables', { ...ipa, storeId: 'bambu' }, admin)
        await archive('stores', 'bambu')

        await service.deleteInventoryItem('stores', 'bambu', admin)

        expect((await repository.listInventory('consumables')).find(({ id }) => id === ipa.id)?.storeId).toBeUndefined()
      })

      it('refuses to buy a consumable from a deleted store', async () => {
        await service.createInventoryItem('stores', { id: 'bambu', name: 'Bambu Lab EU' }, admin)
        await archive('stores', 'bambu')
        await service.deleteInventoryItem('stores', 'bambu', admin)

        await expect(service.updateInventoryItem('consumables', { ...ipa, storeId: 'bambu' }, admin)).rejects.toMatchObject({
          status: 409,
        })
      })

      it('refuses to add a consumable bought from a deleted store', async () => {
        await expect(service.createInventoryItem('consumables', { ...ipa, id: 'new-ipa', storeId: 'gone' }, admin)).rejects.toMatchObject({
          status: 409,
        })
      })

      it('removes the item', async () => {
        await archive('equipment', wash.id)

        await service.deleteInventoryItem('equipment', wash.id, admin)

        expect(await repository.listInventory('equipment')).toEqual([])
      })

      it('takes a deleted printer off its prints but keeps their print type', async () => {
        const requestId = await estimatedPrint()
        await archive('printers', slaPrinter.id)

        await service.deleteInventoryItem('printers', slaPrinter.id, admin)

        expect(await repository.getRequest(requestId)).toMatchObject({ printerId: undefined, requestedPrintType: 'resin' })
      })

      it('keeps a deleted printer’s name on its printing time', async () => {
        const requestId = await estimatedPrint()
        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)
        await archive('printers', slaPrinter.id)

        await service.deleteInventoryItem('printers', slaPrinter.id, admin)

        const usage = (await service.listUsage({}, admin)).sort(
          (a, b) => Number(a.consumableId === undefined) - Number(b.consumableId === undefined),
        )
        expect(
          usage.map(({ printerId, consumableId, deletedItemName, deletedItemKind }) => ({
            printerId,
            consumableId,
            deletedItemName,
            deletedItemKind,
          })),
        ).toEqual([
          { printerId: undefined, consumableId: resin.id, deletedItemName: undefined, deletedItemKind: undefined },
          { printerId: undefined, consumableId: undefined, deletedItemName: slaPrinter.name, deletedItemKind: 'printer' },
        ])
      })

      it('keeps the spend of a deleted material under its name', async () => {
        const requestId = await estimatedPrint()
        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)
        await archive('consumables', resin.id)
        const before = summariseSpend(await service.listUsage({}, admin), await repository.listInventory('consumables'), 'EUR').total

        await service.deleteInventoryItem('consumables', resin.id, admin)

        const spend = summariseSpend(await service.listUsage({}, admin), await repository.listInventory('consumables'), 'EUR')
        expect({ total: spend.total, material: spend.items.find(({ category }) => category === 'material') }).toEqual({
          total: before,
          material: expect.objectContaining({ deletedName: resin.name, amount: 12 }),
        })
      })

      it('stops equipment using a deleted supply', async () => {
        await archive('consumables', ipa.id)

        await service.deleteInventoryItem('consumables', ipa.id, admin)

        expect((await repository.listInventory('equipment'))[0].supplies).toEqual([])
      })

      it('leaves a deleted printer’s wear parts in the library', async () => {
        await stock('consumables', [tank])
        await archive('printers', slaPrinter.id)

        await service.deleteInventoryItem('printers', slaPrinter.id, admin)

        expect((await repository.listInventory('consumables')).find(({ id }) => id === tank.id)).toEqual(tank)
      })

      it('announces the deletion', async () => {
        const publish = vi.fn()
        const announcing = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
        await archive('equipment', wash.id)

        await announcing.deleteInventoryItem('equipment', wash.id, admin)

        expect(publish.mock.calls).toEqual([['inventory.deleted']])
      })

      it('reports the deletion with what named the item', async () => {
        await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 500 }, admin)
        await archive('consumables', ipa.id)
        capture.mockClear()

        await service.deleteInventoryItem('consumables', ipa.id, admin)

        expect(capture.mock.calls).toEqual([
          [
            admin.id,
            'inventory_item_deleted',
            {
              inventory_kind: 'consumables',
              item_kind: 'supply',
              request_count: 0,
              plate_count: 0,
              usage_count: 0,
              stock_count: 1,
              equipment_count: 1,
              part_count: 0,
              consumable_count: 0,
            },
          ],
        ])
      })

      it('never deletes another workspace’s item', async () => {
        await archive('equipment', wash.id)
        const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
        const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

        await expect(otherService.deleteInventoryItem('equipment', wash.id, admin)).rejects.toMatchObject({ status: 404 })
      })

      it('lands a replayed upload unassigned once its printer was deleted', async () => {
        const uploadId = 'upload-to-deleted-printer'
        const part = staging.uploadPart(uploadId)
        await fs.promises.writeFile(part, 'stl')
        await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, 3)
        const requestId = crypto.randomUUID()
        await repository.beginUploadOperation(crypto.randomUUID(), {
          kind: 'upload',
          uploadId,
          ownerId: admin.id,
          requestId,
          partPath: part,
          destinationPath: 'todo/replayed.stl',
          request: { name: 'Replayed', fileName: 'replayed.stl', quantity: 1, ownerUserId: admin.id, printerId: slaPrinter.id },
        })
        await archive('printers', slaPrinter.id)
        await service.deleteInventoryItem('printers', slaPrinter.id, admin)

        await service.recoverOperations()

        expect(await repository.getRequest(requestId)).toMatchObject({ name: 'Replayed', printerId: undefined })
      })
    })

    describe('while tracking is off', () => {
      beforeEach(async () => {
        await repository.setSetting(USAGE_TRACKING_SETTING, false)
      })

      it('refuses to record a step', async () => {
        const requestId = await estimatedPrint()

        await expect(service.recordStepUsage({ requestId, stage: 'finishing', copies: 1 }, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('refuses to record a stock movement', async () => {
        await expect(service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)).rejects.toMatchObject({
          status: 409,
        })
      })

      it('refuses to undo usage', async () => {
        await expect(service.undoUsage('any', admin)).rejects.toMatchObject({ status: 409 })
      })

      it('hides the log', async () => {
        await expect(service.listUsage({}, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('hides stock levels', async () => {
        await expect(service.stockLevels(admin)).rejects.toMatchObject({ status: 409 })
      })

      it('hides printer lifetimes', async () => {
        await expect(service.printerLifetimes(admin)).rejects.toMatchObject({ status: 409 })
      })

      it('keeps the log for when it is turned back on', async () => {
        await repository.setSetting(USAGE_TRACKING_SETTING, true)
        await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)
        await repository.setSetting(USAGE_TRACKING_SETTING, false)
        await repository.setSetting(USAGE_TRACKING_SETTING, true)

        expect(await service.listUsage({}, admin)).toHaveLength(1)
      })
    })

    it('records the printer time and material for every copy at the price it was used at', async () => {
      const requestId = await estimatedPrint()

      const { events } = await service.recordStepUsage(
        { requestId, stage: 'printing', copies: 2, printerId: slaPrinter.id, consumableId: resin.id },
        admin,
      )

      expect(
        events.map(({ printerId, consumableId, amount, unit, unitPrice, currency }) => ({
          printerId,
          consumableId,
          amount,
          unit,
          unitPrice,
          currency,
        })),
      ).toEqual([
        {
          printerId: slaPrinter.id,
          consumableId: undefined,
          amount: 180,
          unit: 'minute',
          unitPrice: expect.closeTo((0.0135 + 0.2) / 60, 9),
          currency: 'EUR',
        },
        { printerId: slaPrinter.id, consumableId: resin.id, amount: 24, unit: 'ml', unitPrice: 0.04, currency: 'EUR' },
      ])
    })

    it('records each piece of equipment and its supplies once per copy', async () => {
      const requestId = await estimatedPrint()

      const { events } = await service.recordStepUsage({ requestId, stage: 'finishing', copies: 3, equipmentIds: [wash.id] }, admin)

      expect(events.map(({ equipmentId, consumableId, amount, unit }) => ({ equipmentId, consumableId, amount, unit }))).toEqual([
        { equipmentId: wash.id, consumableId: undefined, amount: 30, unit: 'minute' },
        { equipmentId: wash.id, consumableId: ipa.id, amount: 60, unit: 'ml' },
      ])
    })

    it("records a printer model's wear parts by the plate", async () => {
      const tank: Consumable = {
        id: 'tank',
        kind: 'part',
        name: 'Tank',
        printType: 'resin',
        price: 190,
        lifespan: 190,
        lifespanUnit: 'plates',
      }
      await stock('consumables', [tank])
      const requestId = await estimatedPrint()

      const { events } = await service.recordStepUsage({ requestId, stage: 'printing', copies: 3, printerId: slaPrinter.id }, admin)

      expect(events.find((event) => event.consumableId === tank.id)).toMatchObject({ amount: 3, unit: 'plate', unitPrice: 1 })
    })

    it('prices equipment time by its power and wear', async () => {
      await revise('equipment', { ...wash, powerWatts: 1_000, purchasePrice: 600, lifespanHours: 1_000 })
      const requestId = await estimatedPrint()

      const { events } = await service.recordStepUsage({ requestId, stage: 'finishing', copies: 1, equipmentIds: [wash.id] }, admin)

      expect(events[0].unitPrice).toBeCloseTo((0.135 + 0.6) / 60, 9)
    })

    it('prices supplies the way the calculator quotes them', async () => {
      const basket: Consumable = {
        id: 'basket',
        kind: 'part',
        name: 'Basket',
        printType: 'resin',
        price: 50,
        lifespan: 100,
        lifespanUnit: 'plates',
      }
      await stock('consumables', [basket])
      await revise('equipment', { ...wash, supplies: [{ consumableId: basket.id, amountPerUse: 1 }] })
      const requestId = await estimatedPrint()

      const { events } = await service.recordStepUsage({ requestId, stage: 'finishing', copies: 2, equipmentIds: [wash.id] }, admin)

      expect(events.find((event) => event.consumableId === basket.id)).toMatchObject({ amount: 2, unit: 'plate', unitPrice: 0.5 })
    })

    it('prefills the printer, material, and finishing set last used', async () => {
      const requestId = await estimatedPrint()
      await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)
      await service.recordStepUsage({ requestId, stage: 'finishing', copies: 1, equipmentIds: [wash.id] }, admin)

      expect(await service.usagePrefills(admin)).toEqual({
        printers: { resin: slaPrinter.id },
        materials: { [slaPrinter.id]: resin.id },
        finishing: { resin: [wash.id] },
      })
    })

    it('records the printer with no minutes when the print has no time estimate', async () => {
      const requestId = await request()

      const { events } = await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id }, admin)

      expect(events.map(({ printerId, amount }) => ({ printerId, amount }))).toEqual([{ printerId: slaPrinter.id, amount: 0 }])
    })

    it('takes a replaced part off the shelf', async () => {
      const tank: Consumable = {
        id: 'tank',
        kind: 'part',
        name: 'Tank',
        printType: 'resin',
        price: 60,
        lifespan: 190,
        lifespanUnit: 'plates',
      }
      await stock('consumables', [tank])
      await service.recordStockMovement({ consumableId: tank.id, kind: 'restock', amount: 2 }, admin)

      await service.recordStockMovement({ consumableId: tank.id, kind: 'replace', amount: 1, printerId: slaPrinter.id }, admin)

      expect((await service.stockLevels(admin)).find(({ consumableId }) => consumableId === tank.id)?.onHand).toBe(1)
    })

    it('counts a printer’s print hours over its whole life', async () => {
      await service.recordStepUsage({ requestId: await estimatedPrint(), stage: 'printing', copies: 2, printerId: slaPrinter.id }, admin)

      expect((await service.printerLifetimes(admin)).find(({ printerId }) => printerId === slaPrinter.id)?.hours).toBe(3)
    })

    it('starts a part’s wear again once it is replaced on the printer', async () => {
      const tank: Consumable = {
        id: 'tank',
        kind: 'part',
        name: 'Tank',
        printType: 'resin',
        price: 60,
        lifespan: 190,
        lifespanUnit: 'plates',
      }
      await stock('consumables', [tank])
      await service.recordStepUsage({ requestId: await estimatedPrint(), stage: 'printing', copies: 2, printerId: slaPrinter.id }, admin)

      await service.recordStockMovement({ consumableId: tank.id, kind: 'replace', amount: 1, printerId: slaPrinter.id }, admin)

      expect((await service.printerLifetimes(admin)).find(({ printerId }) => printerId === slaPrinter.id)?.parts[0].used).toBe(0)
    })

    it('shares one transaction across the events a step records', async () => {
      const requestId = await estimatedPrint()

      const { transactionId, events } = await service.recordStepUsage(
        { requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id },
        admin,
      )

      expect(new Set(events.map((event) => event.transactionId))).toEqual(new Set([transactionId]))
    })

    it('rejects a material that does not suit the print type', async () => {
      const requestId = await estimatedPrint()

      await expect(
        service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: filament.id }, admin),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejects unknown equipment', async () => {
      const requestId = await estimatedPrint()

      await expect(
        service.recordStepUsage({ requestId, stage: 'finishing', copies: 1, equipmentIds: ['missing'] }, admin),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('lets only admins record usage', async () => {
      const requestId = await estimatedPrint()

      await expect(service.recordStepUsage({ requestId, stage: 'finishing', copies: 1 }, requester)).rejects.toMatchObject({
        status: 403,
      })
    })

    it('publishes recorded usage so boards refresh', async () => {
      const publish = vi.fn()
      const scopedService = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })

      await scopedService.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

      expect(publish).toHaveBeenCalledWith('usage.recorded')
    })

    it('counts stock down by what the steps used', async () => {
      const requestId = await estimatedPrint()
      await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

      await service.recordStepUsage({ requestId, stage: 'finishing', copies: 2, equipmentIds: [wash.id] }, admin)

      expect((await service.stockLevels(admin)).find((level) => level.consumableId === ipa.id)?.onHand).toBe(960)
    })

    it('says how much goes per day once stock has a week of history', async () => {
      vi.useFakeTimers({ now: 0, toFake: ['Date'] })
      await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)
      vi.setSystemTime(10 * 86_400_000)
      await service.recordStockMovement({ consumableId: ipa.id, kind: 'waste', amount: 100 }, admin)

      const rates = await service.dailyUse(admin)
      vi.useRealTimers()

      expect(rates).toEqual({ [ipa.id]: 10 })
    })

    it('records a correction as the difference from the amount counted', async () => {
      await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

      const { events } = await service.recordStockMovement({ consumableId: ipa.id, kind: 'correction', counted: 700 }, admin)

      expect(events[0].amount).toBe(-300)
    })

    it('flags stock below its minimum as low', async () => {
      await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 400 }, admin)

      expect((await service.stockLevels(admin)).find((level) => level.consumableId === ipa.id)).toMatchObject({ low: true, missing: false })
    })

    it('puts undone usage back into stock', async () => {
      const { transactionId } = await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)

      await service.undoUsage(transactionId!, admin)

      expect((await service.stockLevels(admin)).find((level) => level.consumableId === ipa.id)?.onHand).toBe(0)
    })

    it('has nothing to undo twice', async () => {
      const { transactionId } = await service.recordStockMovement({ consumableId: ipa.id, kind: 'restock', amount: 1_000 }, admin)
      await service.undoUsage(transactionId!, admin)

      await expect(service.undoUsage(transactionId!, admin)).rejects.toMatchObject({ status: 404 })
    })

    it('captures a recorded step with counts only', async () => {
      const requestId = await estimatedPrint()
      capture.mockClear()

      await service.recordStepUsage({ requestId, stage: 'finishing', copies: 2, equipmentIds: [wash.id] }, admin)

      expect(capture).toHaveBeenCalledWith(admin.id, 'usage_step_recorded', {
        stage: 'finishing',
        print_type: 'resin',
        copy_count: 2,
        event_count: 2,
        has_printer: false,
        has_material: false,
        equipment_count: 1,
        outcome: undefined,
      })
    })

    async function modelledPrint() {
      const id = await request()
      await repository.updateRequest(id, { printerId: slaPrinter.id, estimatedPrintMinutesOverride: 90 })
      await repository.setModelDimensions(id, { widthMm: 10, depthMm: 10, heightMm: 20 }, 10_000, 3_000)
      return id
    }

    async function materialUsed(requestId: string) {
      return (await service.listUsage({ requestId }, admin)).find((event) => event.consumableId === resin.id)?.amount
    }

    it('records a printing step at the estimate with its allowance', async () => {
      const requestId = await modelledPrint()

      await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)

      expect(await materialUsed(requestId)).toBeCloseTo(17)
    })

    it('records a printing step at an adjusted material without the allowance', async () => {
      const requestId = await estimatedPrint()

      await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: slaPrinter.id, consumableId: resin.id }, admin)

      expect(await materialUsed(requestId)).toBe(12)
    })

    describe('filling in past prints', () => {
      const readyAt = new Date(2026, 4, 12).getTime()

      async function pastPrint(movedAt = readyAt) {
        const id = await estimatedPrint()
        await repository.moveCopies({ id, from: 'todo', to: 'done', count: 1, movedAt })
        return id
      }

      it('fills in a print at its estimate with the allowance', async () => {
        const requestId = await modelledPrint()
        await repository.moveCopies({ id: requestId, from: 'todo', to: 'done', count: 1, movedAt: readyAt })

        await service.backfillUsage(admin)

        expect(await materialUsed(requestId)).toBeCloseTo(17)
      })

      it('keeps what it filled in when the allowance changes later', async () => {
        const requestId = await modelledPrint()
        await repository.moveCopies({ id: requestId, from: 'todo', to: 'done', count: 1, movedAt: readyAt })
        await service.backfillUsage(admin)

        await repository.setSetting(PRICE_CALCULATOR_SETTING, {
          ...DEFAULT_PRICE_CALCULATOR_SETTINGS,
          supportsAndWastePercent: { resin: 100, filament: 10 },
        })

        expect(await materialUsed(requestId)).toBeCloseTo(17)
      })

      it('lets only admins fill them in', async () => {
        await pastPrint()

        await expect(service.backfillUsage(requester)).rejects.toMatchObject({ status: 403 })
      })

      it('lets only admins preview them', async () => {
        await expect(service.usageBackfillPreview(requester)).rejects.toMatchObject({ status: 403 })
      })

      it('refuses while tracking is off', async () => {
        await pastPrint()
        await repository.setSetting(USAGE_TRACKING_SETTING, false)

        await expect(service.backfillUsage(admin)).rejects.toMatchObject({ status: 409 })
      })

      it('previews the prints and copies it would fill in', async () => {
        await pastPrint()
        await pastPrint(readyAt + 1_000)

        expect(await service.usageBackfillPreview(admin)).toEqual({ prints: 2, copies: 2, events: 4, from: readyAt, to: readyAt + 1_000 })
      })

      it('dates each print when its copies reached Ready', async () => {
        await pastPrint()

        await service.backfillUsage(admin)

        expect(new Set((await service.listUsage({}, admin)).map((event) => event.createdAt))).toEqual(new Set([readyAt]))
      })

      it('dates an archived print by when its copies reached Ready, not when it was archived', async () => {
        const requestId = await pastPrint()
        await repository.setRequestsArchived([requestId], readyAt + 86_400_000)

        await service.backfillUsage(admin)

        expect(new Set((await service.listUsage({}, admin)).map((event) => event.createdAt))).toEqual(new Set([readyAt]))
      })

      it('marks what it records as estimated', async () => {
        await pastPrint()

        await service.backfillUsage(admin)

        expect(new Set((await service.listUsage({}, admin)).map((event) => event.estimated))).toEqual(new Set([true]))
      })

      it('reports what it filled in', async () => {
        await pastPrint()

        expect(await service.backfillUsage(admin)).toMatchObject({ prints: 1, copies: 1, events: 2, from: readyAt, to: readyAt })
      })

      it('finds nothing new the second time', async () => {
        await pastPrint()
        await service.backfillUsage(admin)

        expect(await service.backfillUsage(admin)).toEqual({ prints: 0, copies: 0, events: 0 })
      })

      it('skips a print whose usage was recorded', async () => {
        const requestId = await pastPrint()
        await service.recordStepUsage({ requestId, stage: 'finishing', copies: 1, equipmentIds: [wash.id] }, admin)

        expect(await service.usageBackfillPreview(admin)).toMatchObject({ prints: 0 })
      })

      it('records everything in one transaction that undo takes back whole', async () => {
        await pastPrint()
        await pastPrint()
        const { transactionId } = await service.backfillUsage(admin)

        await service.undoUsage(transactionId!, admin)

        expect(await service.listUsage({}, admin)).toEqual([])
      })

      it('offers the prints again once undone', async () => {
        await pastPrint()
        const { transactionId } = await service.backfillUsage(admin)
        await service.undoUsage(transactionId!, admin)

        expect(await service.usageBackfillPreview(admin)).toMatchObject({ prints: 1 })
      })

      it('leaves stock as it was', async () => {
        await service.recordStockMovement({ consumableId: resin.id, kind: 'restock', amount: 1_000 }, admin)
        await pastPrint()

        await service.backfillUsage(admin)

        expect((await service.stockLevels(admin)).find((level) => level.consumableId === resin.id)?.onHand).toBe(1_000)
      })

      it('fills in only its own workspace', async () => {
        await pastPrint()
        const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
        await other.setSetting(USAGE_TRACKING_SETTING, true)
        const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

        await otherService.backfillUsage(admin)

        expect(await service.usageBackfillPreview(admin)).toMatchObject({ prints: 1 })
      })

      it('publishes the filled-in usage so other viewers refresh', async () => {
        const publish = vi.fn()
        const scopedService = new STLQuestService(repository, assets, staging, { publish }, telemetry, { remove: removeTusUpload })
        await pastPrint()

        await scopedService.backfillUsage(admin)

        expect(publish).toHaveBeenCalledWith('usage.recorded')
      })

      it('captures a fill-in with counts only', async () => {
        await pastPrint()
        capture.mockClear()

        await service.backfillUsage(admin)

        expect(capture).toHaveBeenCalledWith(admin.id, 'usage_backfilled', { print_count: 1, copy_count: 1, event_count: 2 })
      })
    })

    describe('plates', () => {
      const fdm: PrinterProfile = { id: 'fdm', name: 'X1C', printType: 'filament' }

      beforeEach(async () => {
        await stock('printers', [fdm])
      })

      async function filamentPrint() {
        const id = await request()
        await repository.updateRequest(id, { printerId: fdm.id, estimatedMaterialOverride: 12, estimatedPrintMinutesOverride: 90 })
        return id
      }

      async function linkOnly() {
        const id = await repository.createRequest({
          name: 'Link',
          sourceUrl: 'https://example.com/model',
          quantity: 1,
          ownerUserId: requester.id,
        })
        await repository.updateRequest(id, { printerId: fdm.id })
        return id
      }

      async function plate(...requestIds: string[]) {
        return await service.createPlate(
          { printerId: fdm.id, otherStuff: false, items: requestIds.map((requestId) => ({ requestId, status: 'todo', copies: 1 })) },
          admin,
        )
      }

      function measured(plateId: string, objects: { requestId?: string; amount: number }[], minutes = 60) {
        return {
          plateId,
          minutes,
          materials: [{ consumableId: filament.id }],
          objects: objects.map(({ requestId, amount }) => ({ ...(requestId && { requestId }), amounts: [amount] })),
          overhead: [0],
        }
      }

      async function printing(requestId: string) {
        return (await service.listUsage({ requestId }, admin)).filter((event) => event.stage === 'printing')
      }

      it('lists a plate’s models named by their request tags', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        const { number, updatedAt } = (await repository.getRequest(requestId))!

        expect((await service.plateModels(id, admin)).models).toEqual([
          { requestId, name: `SQ-${number} model.stl`, path: 'todo/model.stl', copies: 1, updatedAt },
        ])
      })

      it('lists a replaced model of the same name as changed', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        async function replace(uploadId: string, contents: string) {
          const part = staging.uploadPart(uploadId)
          await fs.promises.writeFile(part, contents)
          await repository.createUploadSession(uploadId, admin.id, Date.now() + 60_000, contents.length)
          await service.attachModel(uploadId, part, requestId, 'model.stl', admin)
        }
        await replace('replace-first', 'broken mesh')
        const before = (await service.plateModels(id, admin)).models
        await new Promise((resolve) => setTimeout(resolve, 2))
        await replace('replace-second', 'fixed mesh')

        expect((await service.plateModels(id, admin)).models).not.toEqual(before)
      })

      it('leaves prints without a model out of a plate’s models', async () => {
        const kept = await filamentPrint()
        const { id } = await plate(kept, await linkOnly())

        expect(await service.plateModels(id, admin)).toMatchObject({ models: [{ requestId: kept }], skipped: 1 })
      })

      it('refuses a plate with no models at all', async () => {
        const { id } = await plate(await linkOnly())

        await expect(service.plateModels(id, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('keeps a plate’s models from members', async () => {
        const { id } = await plate(await filamentPrint())

        await expect(service.plateModels(id, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('keeps a plate’s models within its workspace', async () => {
        const { id } = await plate(await filamentPrint())
        const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
        await other.setSetting(USAGE_TRACKING_SETTING, true)
        const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

        await expect(otherService.plateModels(id, admin)).rejects.toMatchObject({ status: 404 })
      })

      it('lets only admins plan a plate', async () => {
        const requestId = await filamentPrint()

        await expect(
          service.createPlate({ otherStuff: false, items: [{ requestId, status: 'todo', copies: 1 }] }, requester),
        ).rejects.toMatchObject({
          status: 403,
        })
      })

      it('refuses to plan a plate while tracking is off', async () => {
        const requestId = await filamentPrint()
        await repository.setSetting(USAGE_TRACKING_SETTING, false)

        await expect(plate(requestId)).rejects.toMatchObject({ status: 409 })
      })

      it('numbers plates in the order they were planned', async () => {
        await plate(await filamentPrint())

        expect((await plate(await filamentPrint())).number).toBe(2)
      })

      it('refuses more copies than the print has', async () => {
        const requestId = await filamentPrint()

        await expect(
          service.createPlate({ printerId: fdm.id, otherStuff: false, items: [{ requestId, status: 'todo', copies: 2 }] }, admin),
        ).rejects.toMatchObject({ status: 400 })
      })

      it('records each print’s material at the amount the slicer measured', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect((await printing(requestId)).find((event) => event.consumableId === filament.id)?.amount).toBe(30)
      })

      it('records plate usage as measured rather than estimated', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect((await printing(requestId)).some((event) => event.estimated)).toBe(false)
      })

      it('counts the plate against stock, other stuff on it included', async () => {
        await service.recordStockMovement({ consumableId: filament.id, kind: 'restock', amount: 1_000 }, admin)
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }, { amount: 10 }]), admin)

        expect((await service.stockLevels(admin)).find((level) => level.consumableId === filament.id)?.onHand).toBe(960)
      })

      it('charges no print for objects that are not in STL Quest', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }, { amount: 10 }]), admin)

        expect((await service.listPlates(admin))[0].recording?.otherAmount).toBe(10)
      })

      it('replaces the printing step recorded for the copies on the plate', async () => {
        const requestId = await filamentPrint()
        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: fdm.id, consumableId: filament.id }, admin)
        const { id } = await plate(requestId)

        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([transactionId]))
      })

      it('replaces a filled-in estimate of the print', async () => {
        const requestId = await filamentPrint()
        await repository.moveCopies({ id: requestId, from: 'todo', to: 'done', count: 1 })
        await service.backfillUsage(admin)
        const { id } = await service.createPlate(
          { printerId: fdm.id, otherStuff: false, items: [{ requestId, status: 'done', copies: 1 }] },
          admin,
        )

        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([transactionId]))
      })

      it('keeps a printing step recorded after the plate out of the count', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: fdm.id, consumableId: filament.id }, admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([transactionId]))
      })

      it('says when a printing step was already measured by a plate', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect(await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: fdm.id }, admin)).toMatchObject({
          coveredByPlate: true,
        })
      })

      it('replaces what it recorded before when recorded again', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 25 }]), admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([transactionId]))
      })

      it('keeps replacing the earlier step when recorded again', async () => {
        const requestId = await filamentPrint()
        await service.recordStepUsage({ requestId, stage: 'printing', copies: 1, printerId: fdm.id, consumableId: filament.id }, admin)
        const { id } = await plate(requestId)
        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 25 }]), admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([transactionId]))
      })

      it('brings back the step it replaced when its usage is undone', async () => {
        const requestId = await filamentPrint()
        const step = await service.recordStepUsage(
          { requestId, stage: 'printing', copies: 1, printerId: fdm.id, consumableId: filament.id },
          admin,
        )
        const { id } = await plate(requestId)
        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        await service.undoUsage(transactionId, admin)

        expect(new Set((await printing(requestId)).map((event) => event.transactionId))).toEqual(new Set([step.transactionId]))
      })

      it('goes back to unrecorded when its usage is undone', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        const { transactionId } = await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        await service.undoUsage(transactionId, admin)

        expect((await service.listPlates(admin))[0].recording).toBeUndefined()
      })

      it('undoes its usage when deleted', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        await service.deletePlate(id, admin)

        expect(await service.listUsage({}, admin)).toEqual([])
      })

      it('refuses an object put on a print that is not on the plate', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await expect(service.recordPlate(measured(id, [{ requestId: await filamentPrint(), amount: 30 }]), admin)).rejects.toMatchObject({
          status: 400,
        })
      })

      it('lets only admins record a plate', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await expect(service.recordPlate(measured(id, [{ requestId, amount: 30 }]), requester)).rejects.toMatchObject({ status: 403 })
      })

      it('splits a typed total by model volume', async () => {
        const large = await filamentPrint()
        const small = await filamentPrint()
        await repository.setModelDimensions(large, { widthMm: 10, depthMm: 10, heightMm: 30 }, 3_000)
        await repository.setModelDimensions(small, { widthMm: 10, depthMm: 10, heightMm: 10 }, 1_000)
        const { id } = await plate(large, small)

        const { plate: recorded } = await service.recordPlate(
          { plateId: id, minutes: 60, materials: [{ consumableId: filament.id }], totals: [40], otherShare: 0 },
          admin,
        )

        expect(recorded.items.map(({ requestId, amount }) => ({ requestId, amount }))).toEqual(
          expect.arrayContaining([
            { requestId: large, amount: 30 },
            { requestId: small, amount: 10 },
          ]),
        )
      })

      it('records the slicer’s amount for a print estimated from its model, without the allowance', async () => {
        const requestId = await request()
        await repository.updateRequest(requestId, { printerId: fdm.id, estimatedPrintMinutesOverride: 90 })
        await repository.setModelDimensions(requestId, { widthMm: 10, depthMm: 10, heightMm: 20 }, 10_000, 3_000)
        const { id } = await plate(requestId)

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }]), admin)

        expect((await printing(requestId)).find((event) => event.consumableId === filament.id)?.amount).toBe(30)
      })

      it('splits a typed total by estimates that carry the allowance', async () => {
        const modelled = await request()
        await repository.updateRequest(modelled, { printerId: slaPrinter.id, estimatedPrintMinutesOverride: 90 })
        await repository.setModelDimensions(modelled, { widthMm: 10, depthMm: 10, heightMm: 20 }, 10_000, 3_000)
        const adjusted = await request()
        await repository.updateRequest(adjusted, {
          printerId: slaPrinter.id,
          estimatedMaterialOverride: 34,
          estimatedPrintMinutesOverride: 90,
        })
        const { id } = await service.createPlate(
          {
            printerId: slaPrinter.id,
            otherStuff: false,
            items: [
              { requestId: modelled, status: 'todo', copies: 1 },
              { requestId: adjusted, status: 'todo', copies: 1 },
            ],
          },
          admin,
        )

        const { plate: recorded } = await service.recordPlate(
          { plateId: id, minutes: 60, materials: [{ consumableId: resin.id }], totals: [51], otherShare: 0 },
          admin,
        )

        expect(recorded.items.find(({ requestId }) => requestId === modelled)?.amount).toBeCloseTo(17)
      })

      it('adds a material named on the spot to the library without a price', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)

        await service.recordPlate({ ...measured(id, [{ requestId, amount: 30 }]), materials: [{ name: 'Mystery PLA' }] }, admin)

        expect((await repository.listInventory('consumables')).find(({ name }) => name === 'Mystery PLA')).toMatchObject({
          kind: 'filament',
          pricePerKg: 0,
        })
      })

      it('keeps plates to their own workspace', async () => {
        const { id } = await plate(await filamentPrint())
        const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
        await other.setSetting(USAGE_TRACKING_SETTING, true)
        const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

        await expect(otherService.deletePlate(id, admin)).rejects.toMatchObject({ status: 404 })
      })

      it('refuses slicer amounts for a resin plate, which only takes typed totals', async () => {
        const requestId = await estimatedPrint()
        const { id } = await service.createPlate(
          { printerId: slaPrinter.id, otherStuff: false, items: [{ requestId, status: 'todo', copies: 1 }] },
          admin,
        )

        await expect(
          service.recordPlate(
            { plateId: id, minutes: 60, materials: [{ consumableId: resin.id }], objects: [{ requestId, amounts: [30] }], overhead: [0] },
            admin,
          ),
        ).rejects.toMatchObject({ status: 400 })
      })

      it('captures a recorded plate with counts and its method only', async () => {
        const requestId = await filamentPrint()
        const { id } = await plate(requestId)
        capture.mockClear()

        await service.recordPlate(measured(id, [{ requestId, amount: 30 }, { amount: 10 }]), admin)

        expect(capture).toHaveBeenCalledWith(admin.id, 'plate_recorded', {
          source: 'file',
          method: 'measured',
          print_count: 1,
          filament_count: 1,
          object_count: 2,
          matched_count: 1,
          has_other: true,
          replaced: false,
        })
      })
    })

    describe('plate runs', () => {
      const x2d: PrinterProfile = { id: 'x2d', name: 'X2D', printType: 'filament' }

      beforeEach(async () => {
        await stock('printers', [x2d])
      })

      async function queued() {
        const id = await request()
        await repository.updateRequest(id, { estimatedMaterialOverride: 12, estimatedPrintMinutesOverride: 90 })
        return id
      }

      async function start(...requestIds: string[]) {
        return await service.createPlate(
          { printerId: x2d.id, otherStuff: false, items: requestIds.map((requestId) => ({ requestId, status: 'todo', copies: 1 })) },
          admin,
        )
      }

      const counts = async (requestId: string) => (await repository.getRequest(requestId))!.counts
      const plateOf = async (id: string) => (await service.listPlates(admin)).find((plate) => plate.id === id)!
      const finished = { outcome: 'finished' as const, printerName: 'X2D', minutes: 120, grams: 40 }

      it('moves a started plate’s copies to Printing', async () => {
        const requestId = await queued()

        await start(requestId)

        expect((await counts(requestId)).in_progress).toBe(1)
      })

      it('puts a started plate’s prints on its printer', async () => {
        const requestId = await queued()

        await start(requestId)

        expect((await repository.getRequest(requestId))?.printerId).toBe(x2d.id)
      })

      it('runs a started plate in Printing', async () => {
        const { stage } = await start(await queued())

        expect(stage).toBe('in_progress')
      })

      it('refuses to start a plate without a printer', async () => {
        const requestId = await queued()

        await expect(
          service.createPlate({ otherStuff: false, items: [{ requestId, status: 'todo', copies: 1 }] }, admin),
        ).rejects.toMatchObject({ status: 400 })
      })

      it('refuses to start a plate with copies another running plate holds', async () => {
        const requestId = await queued()
        await start(requestId)

        await expect(
          service.createPlate({ printerId: x2d.id, otherStuff: false, items: [{ requestId, status: 'in_progress', copies: 1 }] }, admin),
        ).rejects.toMatchObject({ status: 409 })
      })

      it('keeps a plate’s copy from moving on its own', async () => {
        const requestId = await queued()
        await start(requestId)

        await expect(
          service.moveCopies({ id: requestId, from: 'in_progress', to: 'post_processing', count: 1 }, admin),
        ).rejects.toMatchObject({
          status: 409,
        })
      })

      it('keeps a plate’s copy out of a batch move', async () => {
        const requestId = await queued()
        await start(requestId)

        await expect(
          service.moveCopiesBatch([{ id: requestId, from: 'in_progress', to: 'up_next', count: 1 }], admin),
        ).rejects.toMatchObject({ status: 409 })
      })

      it('moves every print on a plate together', async () => {
        const first = await queued()
        const second = await queued()
        const { id } = await start(first, second)

        await service.movePlate(id, 'post_processing', admin)

        expect([(await counts(first)).post_processing, (await counts(second)).post_processing]).toEqual([1, 1])
      })

      it('ends a plate’s run once its prints are ready', async () => {
        const { id } = await start(await queued())
        await service.movePlate(id, 'post_processing', admin)

        await service.movePlate(id, 'done', admin)

        expect((await plateOf(id)).stage).toBeUndefined()
      })

      it('captures a plate move with counts only', async () => {
        const { id } = await start(await queued())
        capture.mockClear()

        await service.movePlate(id, 'post_processing', admin)

        expect(capture).toHaveBeenCalledWith(admin.id, 'plate_moved', {
          from_status: 'in_progress',
          to_status: 'post_processing',
          print_count: 1,
          copy_count: 1,
        })
      })

      it('links a reported print to the plate printing on its printer', async () => {
        const { id } = await start(await queued())

        await service.receivePrint(finished)

        expect((await repository.listPrintJobs())[0].plateId).toBe(id)
      })

      it('records a finished print’s measured time on its plate', async () => {
        const { id } = await start(await queued())

        await service.receivePrint(finished)

        expect((await plateOf(id)).recording).toMatchObject({ source: 'printer', minutes: 120 })
      })

      it('records a finished print’s grams against the prints', async () => {
        const requestId = await queued()
        await start(requestId)

        await service.receivePrint(finished)

        expect((await service.listUsage({ requestId }, admin)).find((event) => event.consumableId === filament.id)?.amount).toBe(40)
      })

      it('records a print reported twice once', async () => {
        await start(await queued())

        await service.receivePrint({ ...finished, runId: '7' })
        await service.receivePrint({ ...finished, runId: '7' })

        expect((await service.listUsage({}, admin)).filter((event) => event.unit === 'minute' && !event.undoneAt)).toHaveLength(1)
      })

      it('continues the print its start reported', async () => {
        await start(await queued())

        await service.receivePrint({ outcome: 'printing', printerName: 'X2D', fileName: 'Hull' })
        await service.receivePrint({ ...finished, fileName: 'Hull' })

        expect((await repository.listPrintJobs()).map(({ outcome }) => outcome)).toEqual(['finished'])
      })

      it('sends a failed plate’s copies back to Up next', async () => {
        const requestId = await queued()
        await start(requestId)

        await service.receivePrint({ ...finished, outcome: 'failed' })

        expect((await counts(requestId)).up_next).toBe(1)
      })

      it('records a failed print’s hours as failed usage', async () => {
        const requestId = await queued()
        await start(requestId)

        await service.receivePrint({ ...finished, outcome: 'failed' })

        expect((await service.listUsage({ requestId }, admin)).find((event) => event.unit === 'minute')?.outcome).toBe('failed')
      })

      it('records each tray a finished print reports against the filament of its material', async () => {
        const petg: Consumable = {
          id: 'petg',
          kind: 'filament',
          name: 'PETG',
          filamentPresetId: 'filament-3dhojor-basic-petg',
          pricePerKg: 25,
        }
        await stock('consumables', [petg])
        const requestId = await queued()
        await start(requestId)

        await service.receivePrint({ ...finished, grams: 40, filamentDetails: 'AMS-A T1 PLA: 30.0g | AMS-A T2 PETG: 10.0g' })

        const used = (await service.listUsage({ requestId }, admin)).filter((event) => event.unit === 'g')
        expect(Object.fromEntries(used.map((event) => [event.consumableId, event.amount]))).toEqual({ [filament.id]: 30, [petg.id]: 10 })
      })

      it('splits a failed print’s grams by what the plate’s slicer file measured for each print', async () => {
        const first = await queued()
        const second = await queued()
        const { id } = await start(first, second)
        await service.recordPlate(
          {
            plateId: id,
            minutes: 60,
            materials: [{ consumableId: filament.id }],
            objects: [
              { requestId: first, amounts: [30] },
              { requestId: second, amounts: [10] },
            ],
            overhead: [0],
          },
          admin,
        )

        await service.receivePrint({ ...finished, outcome: 'failed', grams: 8 })

        const failed = async (requestId: string) =>
          (await service.listUsage({ requestId }, admin)).find((event) => event.outcome === 'failed' && event.unit === 'g')?.amount
        expect([await failed(first), await failed(second)]).toEqual([6, 2])
      })

      it('ends a failed plate’s run', async () => {
        const { id } = await start(await queued())

        await service.receivePrint({ ...finished, outcome: 'cancelled' })

        expect((await plateOf(id)).stage).toBeUndefined()
      })

      it('shows the outcome on the plate', async () => {
        const { id } = await start(await queued())

        await service.receivePrint({ ...finished, outcome: 'failed' })

        expect((await plateOf(id)).print?.outcome).toBe('failed')
      })

      it('links a later print on the printer to no plate whose own print already ended', async () => {
        await start(await queued())
        await service.receivePrint({ ...finished, fileName: 'First' })

        await service.receivePrint({ ...finished, outcome: 'failed', fileName: 'Second' })

        expect((await repository.listPrintJobs()).find(({ fileName }) => fileName === 'Second')?.plateId).toBeUndefined()
      })

      it('keeps a plate’s copies when a later print on its printer fails', async () => {
        const requestId = await queued()
        await start(requestId)
        await service.receivePrint({ ...finished, fileName: 'First' })

        await service.receivePrint({ ...finished, outcome: 'failed', fileName: 'Second' })

        expect((await counts(requestId)).in_progress).toBe(1)
      })

      it('links a reprint by its tag to no plate whose run already failed', async () => {
        const requestId = await queued()
        await start(requestId)
        await service.receivePrint({ ...finished, outcome: 'failed' })
        const { number } = (await repository.getRequest(requestId))!

        await service.receivePrint({ ...finished, printerName: 'Somewhere else', fileName: `SQ-${number} Hull` })

        expect((await repository.listPrintJobs()).find(({ printerName }) => printerName === 'Somewhere else')?.plateId).toBeUndefined()
      })

      it('refuses to delete a request a running plate holds', async () => {
        const requestId = await queued()
        await start(requestId)

        await expect(service.remove(requestId, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('refuses to move a running plate’s print to another printer', async () => {
        await stock('printers', [{ id: 'a1', name: 'A1', printType: 'filament' }])
        const requestId = await queued()
        await start(requestId)

        await expect(service.update(requestId, { printerId: 'a1' }, admin)).rejects.toMatchObject({ status: 409 })
      })

      it('refuses a bulk printer assignment that would split a running plate', async () => {
        await stock('printers', [{ id: 'a1', name: 'A1', printType: 'filament' }])
        const free = await queued()
        const held = await queued()
        await start(held)

        await expect(service.assignRequests([free, held], 'a1', admin)).rejects.toMatchObject({ status: 409 })
      })

      it('leaves every print where it was when a bulk assignment is refused', async () => {
        await stock('printers', [{ id: 'a1', name: 'A1', printType: 'filament' }])
        const free = await queued()
        const held = await queued()
        await start(held)

        await service.assignRequests([free, held], 'a1', admin).catch(() => undefined)

        expect((await repository.getRequest(free))?.printerId).not.toBe('a1')
      })

      it('ends running plates when usage tracking is switched off', async () => {
        const { id } = await start(await queued())

        await service.setUsageTracking(false, admin)

        expect((await repository.listPlates()).find((plate) => plate.id === id)?.stage).toBeUndefined()
      })

      it('links a print by the request tag in its name', async () => {
        const requestId = await queued()
        const { id } = await start(requestId)
        const { number } = (await repository.getRequest(requestId))!

        await service.receivePrint({ ...finished, printerName: 'Somewhere else', fileName: `SQ-${number} Hull` })

        expect((await repository.listPrintJobs())[0].plateId).toBe(id)
      })

      it('leaves a print with no plate unlinked', async () => {
        await service.receivePrint(finished)

        expect((await service.printJobs(admin))[0].plateId).toBeUndefined()
      })

      it('suggests the request an unlinked print is tagged with', async () => {
        const requestId = await queued()
        const { number } = (await repository.getRequest(requestId))!

        await service.receivePrint({ ...finished, fileName: `SQ-${number} Hull` })

        expect((await service.printJobs(admin))[0].suggested?.requestId).toBe(requestId)
      })

      it('records an unlinked print once attached to a request', async () => {
        const requestId = await queued()
        await service.receivePrint(finished)

        await service.attachPrintJob({ jobId: (await repository.listPrintJobs())[0].id, requestId }, admin)

        expect((await service.listPlates(admin))[0].recording?.minutes).toBe(120)
      })

      it('marks an unlinked print personal', async () => {
        await service.receivePrint(finished)
        const [{ id }] = await repository.listPrintJobs()

        await service.setPrintJobPersonal(id, true, admin)

        expect((await repository.listPrintJobs())[0].personal).toBe(true)
      })

      it('lets only admins attach a print', async () => {
        await service.receivePrint(finished)
        const [{ id }] = await repository.listPrintJobs()

        await expect(service.attachPrintJob({ jobId: id, requestId: await queued() }, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('counts a printer’s failed plate runs', async () => {
        await start(await queued())
        await service.receivePrint({ ...finished, outcome: 'failed' })

        expect((await service.printerLifetimes(admin)).find(({ printerId }) => printerId === x2d.id)?.runs).toEqual({
          printerId: x2d.id,
          runs: 1,
          failed: 1,
        })
      })

      it('counts a plate run of several prints as one plate', async () => {
        await start(await queued(), await queued())

        await service.receivePrint(finished)

        expect((await repository.maintenanceTotals()).printers.find(({ printerId }) => printerId === x2d.id)?.recorded.plates).toBe(1)
      })

      it('captures a received print without its names', async () => {
        await start(await queued())
        capture.mockClear()

        await service.receivePrint({ ...finished, fileName: 'Secret project' })

        expect(capture).toHaveBeenCalledWith('server', 'print_received', { outcome: 'finished', linked_by: 'printer', has_printer: true })
      })

      describe('sliced files from Bambuddy', () => {
        const PLA = { type: 'PLA', color: '#000000', density: 1.24, diameter: 1.75 }
        const tag = async (requestId: string, name: string) => `SQ-${(await repository.getRequest(requestId))!.number} ${name}`
        const grams = async (requestId: string) =>
          (await service.listUsage({ requestId }, admin))
            .filter((event) => event.unit === 'g' && !event.undoneAt)
            .reduce((total, { amount }) => total + amount, 0)
        async function twoPrints() {
          const hull = await queued()
          const turret = await queued()
          await start(hull, turret)
          return { hull, turret }
        }
        async function hullAndTurretFile(hull: string, turret: string) {
          return slicedPlateFile({
            filaments: [PLA],
            objects: [
              { id: '1', name: await tag(hull, 'Hull.stl'), extrusionMm: 3000 },
              { id: '2', name: await tag(turret, 'Turret.stl'), extrusionMm: 1000 },
            ],
          })
        }

        it('splits a finished print’s measured grams by the objects in its sliced file', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([expect.closeTo(30, 6), expect.closeTo(10, 6)])
        })

        it('records the plate as split by the sliced file, from the printer', async () => {
          const { hull, turret } = await twoPrints()
          const { id } = (await repository.listPlates())[0]
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect((await plateOf(id)).recording).toMatchObject({ source: 'printer', method: 'measured', minutes: 120 })
        })

        it('keeps the measured hours', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          const minutes = (await service.listUsage({}, admin)).filter((event) => event.unit === 'minute' && !event.undoneAt)
          expect(minutes.reduce((total, { amount }) => total + amount, 0)).toBeCloseTo(120, 6)
        })

        it('keeps a plate recorded from a slicer file by hand', async () => {
          const { hull, turret } = await twoPrints()
          const { id } = (await repository.listPlates())[0]
          await service.recordPlate(
            {
              plateId: id,
              minutes: 60,
              materials: [{ consumableId: filament.id }],
              objects: [
                { requestId: hull, amounts: [5] },
                { requestId: turret, amounts: [5] },
              ],
              overhead: [0],
            },
            admin,
          )
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([5, 5])
        })

        it('charges a failed print’s short object in full and its tall one up to where it stopped', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', progress: 50, grams: 71, runId: '7' })
          const file = layeredPlateFile([
            { id: '1', name: await tag(turret, 'Turret.stl'), layers: 20, mmPerLayer: 10 },
            { id: '2', name: await tag(hull, 'Hull.stl'), layers: 100, mmPerLayer: 10 },
          ])

          await receiveSliced(service, { runId: '7' }, file)

          expect([await grams(turret), await grams(hull)]).toEqual([expect.closeTo(20, 6), expect.closeTo(51, 6)])
        })

        it('weighs a failed print’s waste by the whole plate when its file has no progress markers', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', progress: 50, grams: 60, runId: '7' })
          const file = layeredPlateFile(
            [
              { id: '1', name: await tag(turret, 'Turret.stl'), layers: 20, mmPerLayer: 10 },
              { id: '2', name: await tag(hull, 'Hull.stl'), layers: 100, mmPerLayer: 10 },
            ],
            { markers: false },
          )

          await receiveSliced(service, { runId: '7' }, file)

          expect([await grams(turret), await grams(hull)]).toEqual([expect.closeTo(10, 6), expect.closeTo(50, 6)])
        })

        it('charges nothing from the file for a failed print that measured nothing', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', grams: undefined, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([0, 0])
        })

        it('charges nothing from the file for a failed print that measured nothing at a progress', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', progress: 50, grams: undefined, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([0, 0])
        })

        it('charges nothing from the file for a failed print that measured no grams before it got anywhere', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', progress: 0, grams: 0, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([0, 0])
        })

        it('splits a failed print’s grams by its whole plate when it reported no progress', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', grams: 8, runId: '7' })
          const file = layeredPlateFile([
            { id: '1', name: await tag(turret, 'Turret.stl'), layers: 20, mmPerLayer: 10 },
            { id: '2', name: await tag(hull, 'Hull.stl'), layers: 100, mmPerLayer: 10 },
          ])

          await receiveSliced(service, { runId: '7' }, file)

          expect([await grams(turret), await grams(hull)]).toEqual([expect.closeTo(8 / 6, 6), expect.closeTo(40 / 6, 6)])
        })

        it('splits a print whose file arrived while its end was being recorded', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          const file = await hullAndTurretFile(hull, turret)
          let reached!: () => void
          const atRecord = new Promise<void>((resolve) => (reached = resolve))
          let release!: () => void
          const gate = new Promise<void>((resolve) => (release = resolve))
          const recordPlate = repository.recordPlate.bind(repository)
          vi.spyOn(repository, 'recordPlate').mockImplementationOnce(async (...args) => {
            reached()
            await gate
            return await recordPlate(...args)
          })
          let sliced!: Promise<void>
          const listPlates = repository.listPlates.bind(repository)
          vi.spyOn(repository, 'listPlates').mockImplementationOnce(async () => {
            sliced = receiveSliced(service, { runId: '7' }, file)
            await atRecord
            return await listPlates()
          })

          await service.receivePrint({ ...finished, runId: '7' })
          release()
          await sliced

          expect([await grams(hull), await grams(turret)]).toEqual([expect.closeTo(30, 6), expect.closeTo(10, 6)])
        })

        it('splits a print whose end was recorded while its file was being taken in', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          await service.receivePrint({ ...finished, minutes: undefined, runId: '7' })
          const listRequests = repository.listRequests.bind(repository)
          vi.spyOn(repository, 'listRequests').mockImplementationOnce(async () => {
            await service.receivePrint({ ...finished, runId: '7' })
            return await listRequests()
          })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect([await grams(hull), await grams(turret)]).toEqual([expect.closeTo(30, 6), expect.closeTo(10, 6)])
        })

        it('does not move a failed plate’s copies twice', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, outcome: 'failed', progress: 50, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect((await counts(hull)).up_next).toBe(1)
        })

        it('asks for an ended print’s sliced file with its archive', async () => {
          await twoPrints()
          await service.receivePrint({ ...finished, runId: '7', archiveId: '3' })

          expect(await service.slicedFilesWanted()).toEqual([{ runId: '7', archiveId: '3' }])
        })

        it('stops asking for a file once it has it', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect(await service.slicedFilesWanted()).toEqual([])
        })

        it('refuses a file it cannot read', async () => {
          await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })

          await expect(receiveSliced(service, { runId: '7' }, new TextEncoder().encode('nope'))).rejects.toMatchObject({
            status: 422,
          })
        })

        it('stops asking for a file it could not read', async () => {
          await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, new TextEncoder().encode('nope')).catch(() => undefined)

          expect(await service.slicedFilesWanted()).toEqual([])
        })

        it('refuses a file of several plates without the plate that printed', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })
          const { unzipSync, zipSync } = await import('fflate')
          const single = unzipSync(await hullAndTurretFile(hull, turret))
          const file = zipSync({ ...single, 'Metadata/plate_2.gcode': single['Metadata/plate_1.gcode'] })

          await expect(receiveSliced(service, { runId: '7' }, file)).rejects.toMatchObject({ status: 422 })
        })

        it('reads the plate that printed from a file of several', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })
          const { unzipSync, zipSync } = await import('fflate')
          const single = unzipSync(await hullAndTurretFile(hull, turret))
          const info = new TextDecoder().decode(single['Metadata/slice_info.config'])
          const plates = info.replace(/<plate>[\s\S]*<\/plate>/, (one) => `${one}${one.replace('value="1"', 'value="2"')}`)
          const file = zipSync({
            ...single,
            'Metadata/plate_2.gcode': single['Metadata/plate_1.gcode'],
            'Metadata/plate_1.gcode': new TextEncoder().encode('M83\nG1 E100\n'),
            'Metadata/slice_info.config': new TextEncoder().encode(plates),
          })

          await receiveSliced(service, { runId: '7', plate: 2 }, file)

          expect(await grams(hull)).toBeCloseTo(30, 6)
        })

        it('asks to send a file again for a print it has not heard of yet', async () => {
          await expect(receiveSliced(service, { runId: '8' }, new Uint8Array())).rejects.toMatchObject({ status: 404 })
        })

        it('ignores a file for a print it does not want one for', async () => {
          await service.receivePrint({ ...finished, runId: '7' })

          await receiveSliced(service, { runId: '7' }, new TextEncoder().encode('nope'))

          expect((await repository.listPrintJobs())[0].slicedPlate).toBeUndefined()
        })

        it('captures a sliced file with counts only', async () => {
          const { hull, turret } = await twoPrints()
          await service.receivePrint({ ...finished, runId: '7' })
          capture.mockClear()

          await receiveSliced(service, { runId: '7' }, await hullAndTurretFile(hull, turret))

          expect(capture).toHaveBeenCalledWith('server', 'print_sliced_file_received', {
            outcome: 'finished',
            object_count: 2,
            matched_count: 2,
            cut: false,
            recorded: true,
          })
        })
      })

      describe('per spool', () => {
        const petg: Consumable = { id: 'petg', kind: 'filament', name: 'PETG', pricePerKg: 25 }
        const used = async (requestId: string) =>
          (await service.listUsage({ requestId }, admin))
            .filter((event) => event.unit === 'g' && !event.undoneAt)
            .map(({ consumableId, amount }) => [consumableId, amount] as const)
            .toSorted((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''))

        beforeEach(async () => {
          await stock('consumables', [petg])
          await service.connectSpoolman('hash', admin)
          await service.receiveSpoolman({
            replace: [
              { id: 1, filamentId: 10, archived: false },
              { id: 2, filamentId: 20, archived: false },
            ],
          })
          await service.linkSpoolmanFilament({ filamentId: 10, choice: filament.id }, admin)
          await service.linkSpoolmanFilament({ filamentId: 20, choice: petg.id }, admin)
        })

        it('charges each spool’s grams to the filament its Spoolman filament counts towards', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, runId: '7' })

          await service.receivePrintUsage({
            runId: '7',
            spools: [
              { spoolId: 1, grams: 30 },
              { spoolId: 2, grams: 10 },
            ],
          })

          expect(await used(requestId)).toEqual([
            [petg.id, 10],
            [filament.id, 30],
          ])
        })

        it('charges a spool Spoolman never sent to the first filament', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, runId: '7' })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 99, grams: 12 }] })

          expect(await used(requestId)).toEqual([[filament.id, 12]])
        })

        it('uses spools reported before the print reached a plate once it is attached', async () => {
          const requestId = await queued()
          await service.receivePrint({ ...finished, runId: '7' })
          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 9 }] })
          const [job] = await repository.listPrintJobs()

          await service.attachPrintJob({ jobId: job.id, requestId }, admin)

          expect(await used(requestId)).toEqual([[petg.id, 9]])
        })

        it('re-records a failed print’s usage by spool without moving its copies again', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'failed', runId: '7' })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })

          expect([await used(requestId), (await counts(requestId)).up_next]).toEqual([[[petg.id, 5]], 1])
        })

        it('keeps a failed print’s usage when recording it again by spool fails', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'failed', runId: '7' })
          const before = await used(requestId)
          vi.spyOn(repository as unknown as { insertUsageEvents: () => Promise<void> }, 'insertUsageEvents').mockRejectedValueOnce(
            new Error('disk full'),
          )

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] }).catch(() => undefined)

          expect(await used(requestId)).toEqual(before)
        })

        it('records a failed print again by spool once a failed attempt is retried', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'failed', runId: '7' })
          vi.spyOn(repository as unknown as { insertUsageEvents: () => Promise<void> }, 'insertUsageEvents').mockRejectedValueOnce(
            new Error('disk full'),
          )
          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] }).catch(() => undefined)

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })

          expect(await used(requestId)).toEqual([[petg.id, 5]])
        })

        it('leaves a failed print’s usage undone once its user undid it', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'failed', runId: '7' })
          await service.undoUsage((await repository.listPrintJobs())[0].transactionId!, admin)

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })

          expect(await used(requestId)).toEqual([])
        })

        it('keeps the spools a print reported while its end was being recorded', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          const spools = [{ spoolId: 2, grams: 9 }]
          const listPlates = repository.listPlates.bind(repository)
          vi.spyOn(repository, 'listPlates').mockImplementationOnce(async () => {
            await service.receivePrintUsage({ runId: '7', spools })
            return await listPlates()
          })

          await service.receivePrint({ ...finished, runId: '7' })

          expect([(await repository.listPrintJobs())[0].filamentUsage, await used(requestId)]).toEqual([spools, [[petg.id, 9]]])
        })

        it('records a failed print by the spools it reported while its end was being recorded', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          const listPlates = repository.listPlates.bind(repository)
          vi.spyOn(repository, 'listPlates').mockImplementationOnce(async () => {
            await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })
            return await listPlates()
          })

          await service.receivePrint({ ...finished, outcome: 'failed', runId: '7' })

          expect(await used(requestId)).toEqual([[petg.id, 5]])
        })

        it('keeps an end that arrived while the bridge’s spools were being taken in', async () => {
          await start(await queued())
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          const listPrintJobs = repository.listPrintJobs.bind(repository)
          vi.spyOn(repository, 'listPrintJobs').mockImplementationOnce(async () => {
            const read = await listPrintJobs()
            await service.receivePrint({ ...finished, runId: '7' })
            return read
          })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 9 }] })

          expect((await repository.listPrintJobs())[0].outcome).toBe('finished')
        })

        it('records by spool an end that arrived while the bridge’s spools were being taken in', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, outcome: 'printing', runId: '7' })
          const listPrintJobs = repository.listPrintJobs.bind(repository)
          vi.spyOn(repository, 'listPrintJobs').mockImplementationOnce(async () => {
            const read = await listPrintJobs()
            await service.receivePrint({ ...finished, runId: '7' })
            return read
          })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 9 }] })

          expect(await used(requestId)).toEqual([[petg.id, 9]])
        })

        it('keeps a plate recorded from typed totals while the bridge’s spools were on their way', async () => {
          const requestId = await queued()
          const { id } = await start(requestId)
          await service.receivePrint({ ...finished, runId: '7' })
          const listSpools = repository.listSpoolmanSpools.bind(repository)
          vi.spyOn(repository, 'listSpoolmanSpools').mockImplementationOnce(async () => {
            await service.recordPlate(
              { plateId: id, minutes: 60, materials: [{ consumableId: filament.id }], totals: [20], otherShare: 0 },
              admin,
            )
            return await listSpools()
          })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })

          expect(await used(requestId)).toEqual([[filament.id, 20]])
        })

        it('keeps a plate recorded from typed totals while its end was being recorded', async () => {
          const requestId = await queued()
          const { id } = await start(requestId)
          const consumables = repository.listInventory.bind(repository)
          const spy = vi.spyOn(repository, 'listInventory')
          spy.mockImplementation(async (kind) => {
            if (kind === 'consumables' && spy.mock.calls.filter(([called]) => called === 'consumables').length === 1) {
              await service.recordPlate(
                { plateId: id, minutes: 60, materials: [{ consumableId: filament.id }], totals: [20], otherShare: 0 },
                admin,
              )
            }
            return await consumables(kind)
          })

          await service.receivePrint({ ...finished, runId: '7' })

          expect(await used(requestId)).toEqual([[filament.id, 20]])
        })

        it('keeps a plate recorded from a slicer file', async () => {
          const requestId = await queued()
          const { id } = await start(requestId)
          await service.recordPlate(
            { plateId: id, minutes: 60, materials: [{ consumableId: filament.id }], totals: [20], otherShare: 0 },
            admin,
          )
          await service.receivePrint({ ...finished, runId: '7' })

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 2, grams: 5 }] })

          expect(await used(requestId)).toEqual([[filament.id, 20]])
        })

        it('records a print’s spools reported twice once', async () => {
          const requestId = await queued()
          await start(requestId)
          await service.receivePrint({ ...finished, runId: '7' })
          const report = { runId: '7', spools: [{ spoolId: 1, grams: 30 }] }

          await service.receivePrintUsage(report)
          const { transactionId } = (await repository.listPrintJobs())[0]
          await service.receivePrintUsage(report)

          expect((await repository.listPrintJobs())[0].transactionId).toBe(transactionId)
        })

        it('keeps the sliced file’s split when the spools arrive after it', async () => {
          const hull = await queued()
          const turret = await queued()
          await start(hull, turret)
          await service.receivePrint({ ...finished, runId: '7' })
          const tag = async (requestId: string, name: string) => `SQ-${(await repository.getRequest(requestId))!.number} ${name}`
          const file = slicedPlateFile({
            objects: [
              { id: '1', name: await tag(hull, 'Hull.stl'), extrusionMm: 3000 },
              { id: '2', name: await tag(turret, 'Turret.stl'), extrusionMm: 1000 },
            ],
          })
          await receiveSliced(service, { runId: '7' }, file)

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 1, grams: 80 }] })

          expect([await used(hull), await used(turret)]).toEqual([
            [[filament.id, expect.closeTo(60, 6)]],
            [[filament.id, expect.closeTo(20, 6)]],
          ])
        })

        it('asks to send spools again for a print it has not heard of yet', async () => {
          await expect(service.receivePrintUsage({ runId: '8', spools: [{ spoolId: 1, grams: 1 }] })).rejects.toMatchObject({ status: 404 })
        })

        it('captures spools received with counts only', async () => {
          await start(await queued())
          await service.receivePrint({ ...finished, runId: '7' })
          capture.mockClear()

          await service.receivePrintUsage({ runId: '7', spools: [{ spoolId: 1, grams: 30 }] })

          expect(capture).toHaveBeenCalledWith('server', 'print_spools_received', { spool_count: 1, matched_count: 1, recorded: true })
        })
      })
    })

    describe('what a print was charged', () => {
      it('records it in the workspace currency', async () => {
        const requestId = await request()

        await service.setRequestCharge(requestId, 25, admin)

        expect((await repository.getRequest(requestId))?.charged).toEqual({ amount: 25, currency: 'EUR' })
      })

      it('clears it', async () => {
        const requestId = await request()
        await service.setRequestCharge(requestId, 25, admin)

        await service.setRequestCharge(requestId, null, admin)

        expect((await repository.getRequest(requestId))?.charged).toBeUndefined()
      })

      it('lets only admins record it', async () => {
        const requestId = await request()

        await expect(service.setRequestCharge(requestId, 25, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('shows it to admins', async () => {
        const requestId = await request()
        await service.setRequestCharge(requestId, 25, admin)

        expect((await service.listRequests(admin)).requests[0].charged).toEqual({ amount: 25, currency: 'EUR' })
      })

      it('hides it from the person who asked for the print', async () => {
        const requestId = await request()
        await service.setRequestCharge(requestId, 25, admin)

        expect((await service.listRequests(requester)).requests[0].charged).toBeUndefined()
      })

      describe('over the print’s whole life', () => {
        const october = new Date(2026, 9, 20).getTime()
        const november = new Date(2026, 10, 12).getTime()

        async function spanningPrint() {
          const requestId = await request()
          await service.setRequestCharge(requestId, 20, admin)
          const used = (createdAt: number) => ({
            id: crypto.randomUUID(),
            transactionId: crypto.randomUUID(),
            stage: 'printing' as const,
            kind: 'use' as const,
            requestId,
            consumableId: ipa.id,
            amount: 100,
            unit: 'ml' as const,
            unitPrice: 0.04,
            currency: 'EUR' as const,
            createdAt,
          })
          await repository.appendUsageEvents([used(october), used(november)])
          return requestId
        }

        it('gives each charged print what it used in every period and when it finished', async () => {
          const requestId = await spanningPrint()

          expect(await service.chargedPrints(admin)).toEqual([
            { requestId, charged: { amount: 20, currency: 'EUR' }, cost: expect.closeTo(8), finishedAt: november },
          ])
        })

        it('shows them only to admins', async () => {
          await expect(service.chargedPrints(requester)).rejects.toMatchObject({ status: 403 })
        })

        it('hides them while tracking is off', async () => {
          await repository.setSetting(USAGE_TRACKING_SETTING, false)

          await expect(service.chargedPrints(admin)).rejects.toMatchObject({ status: 409 })
        })

        it('keeps them within their workspace', async () => {
          await spanningPrint()
          const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
          await other.setSetting(USAGE_TRACKING_SETTING, true)
          const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

          expect(await otherService.chargedPrints(admin)).toEqual([])
        })
      })
    })
  })

  describe('Spoolman', () => {
    const black: Consumable = {
      id: 'basic-black',
      kind: 'filament',
      name: 'Bambu Lab PLA · Black',
      filamentPresetId: 'filament-bambu-lab-pla',
      colour: { name: 'Black', hex: '#000000' },
      pricePerKg: 20,
      minimumStock: 1_000,
    }
    const white: Consumable = { id: 'white', kind: 'filament', name: 'Own white', pricePerKg: 18 }
    const spool = {
      id: 1,
      filamentId: 10,
      vendor: 'Bambu Lab',
      material: 'PLA',
      externalId: 'bambulab_pla_black_1000_175_n',
      archived: false,
    }

    beforeEach(async () => {
      await stock('consumables', [black, white])
      await repository.setSetting(USAGE_TRACKING_SETTING, true)
      await service.connectSpoolman('hash', admin)
    })

    const level = async (id: string) => (await service.stockLevels(admin)).find((stocked) => stocked.consumableId === id)

    it('takes a matched filament stock from the spools Spoolman sent', async () => {
      await service.receiveSpoolman({
        replace: [
          { ...spool, remainingGrams: 600 },
          { ...spool, id: 2, remainingGrams: 300 },
        ],
      })

      expect(await level(black.id)).toMatchObject({ onHand: 900, low: true, spoolman: { spools: 2 } })
    })

    it('replaces every spool when Spoolman sends them all', async () => {
      await service.receiveSpoolman({
        replace: [
          { ...spool, remainingGrams: 600 },
          { ...spool, id: 2, remainingGrams: 300 },
        ],
      })

      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 450 }] })

      expect((await level(black.id))?.onHand).toBe(450)
    })

    it('updates one spool from a single event', async () => {
      await service.receiveSpoolman({
        replace: [
          { ...spool, remainingGrams: 600 },
          { ...spool, id: 2, remainingGrams: 300 },
        ],
      })

      await service.receiveSpoolman({ upsert: { ...spool, id: 2, remainingGrams: 100 } })

      expect((await level(black.id))?.onHand).toBe(700)
    })

    it('forgets a deleted spool', async () => {
      await service.receiveSpoolman({
        replace: [
          { ...spool, remainingGrams: 600 },
          { ...spool, id: 2, remainingGrams: 300 },
        ],
      })

      await service.receiveSpoolman({ remove: 2 })

      expect((await level(black.id))?.onHand).toBe(600)
    })

    it('refuses a new spool past the limit', async () => {
      await service.receiveSpoolman({ replace: Array.from({ length: 5_000 }, (_, id) => ({ ...spool, id, remainingGrams: 1 })) })

      await expect(service.receiveSpoolman({ upsert: { ...spool, id: 5_000 } })).rejects.toMatchObject({ status: 413 })
    })

    it('waits for the first send again once the token is replaced', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })

      await service.connectSpoolman('replacement-hash', admin)

      expect((await service.spoolman(admin)).connection?.receivedAt).toBeUndefined()
    })

    it('refuses spools once disconnected', async () => {
      await service.disconnectSpoolman(admin)

      await expect(service.receiveSpoolman({ replace: [spool] })).rejects.toMatchObject({ status: 401 })
    })

    it('hands stock back to the usage log when disconnected', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })

      await service.disconnectSpoolman(admin)

      expect((await level(black.id))?.spoolman).toBeUndefined()
    })

    it('refuses stock movements on a filament Spoolman manages', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })

      await expect(service.recordStockMovement({ consumableId: black.id, kind: 'restock', amount: 1_000 }, admin)).rejects.toMatchObject({
        status: 409,
      })
    })

    it('counts a filament linked by hand', async () => {
      await service.receiveSpoolman({ replace: [{ id: 3, filamentId: 20, material: 'PLA', remainingGrams: 250, archived: false }] })

      await service.linkSpoolmanFilament({ filamentId: 20, choice: white.id }, admin)

      expect((await level(white.id))?.onHand).toBe(250)
    })

    it('stops counting a filament unlinked by hand', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })

      await service.linkSpoolmanFilament({ filamentId: 10, choice: 'none' }, admin)

      expect((await level(black.id))?.spoolman).toBeUndefined()
    })

    it('refuses to link a filament the library lacks', async () => {
      await expect(service.linkSpoolmanFilament({ filamentId: 10, choice: 'missing' }, admin)).rejects.toMatchObject({ status: 400 })
    })

    it('lists the filaments Spoolman sent with what each counts towards', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })

      expect((await service.spoolman(admin)).filaments).toEqual([
        expect.objectContaining({ id: 10, choice: 'auto', match: { consumableId: black.id, by: 'catalogue' }, remainingGrams: 600 }),
      ])
    })

    it('shows the connection only to admins', async () => {
      await expect(service.spoolman(requester)).rejects.toMatchObject({ status: 403 })
    })

    it('reports the first spools received since connecting', async () => {
      capture.mockClear()

      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 500 }] })

      expect(capture.mock.calls.filter((call) => (call as unknown[])[1] === 'spoolman_first_received')).toEqual([
        ['server', 'spoolman_first_received', { filament_count: 1, matched_count: 1, spool_count: 1 }],
      ])
    })

    it('keeps spools within their workspace', async () => {
      await service.receiveSpoolman({ replace: [{ ...spool, remainingGrams: 600 }] })
      const other = await repository.scoped((await repository.createWorkspace({ id: admin.id }, 'Second farm')).id)
      const otherService = new STLQuestService(other, assets, staging, eventBus(), telemetry, { remove: removeTusUpload })

      expect((await otherService.spoolman(admin)).filaments).toEqual([])
    })

    describe('adding spools', () => {
      const order = { vendor: 'bambu-lab' as const, added: [], prices: [], restocks: [] }
      const queue = (spools = 2) =>
        service.restockFromOrder({ ...order, spoolman: [{ consumableId: black.id, spools, grams: 1_000 }] }, admin)

      beforeEach(async () => {
        await service.receiveSpoolman({ replace: [{ ...spool, filamentName: 'Black', remainingGrams: 600 }] })
      })

      it('queues a restock of a filament Spoolman manages for the bridge to add', async () => {
        await queue()

        expect((await service.spoolmanRestocks(admin)).map(({ filamentId, grams, status }) => [filamentId, grams, status])).toEqual([
          [10, 1_000, 'queued'],
          [10, 1_000, 'queued'],
        ])
      })

      it('leaves the stock of a filament Spoolman manages to Spoolman', async () => {
        await queue()

        expect((await level(black.id))?.onHand).toBe(600)
      })

      it('refuses to queue a filament Spoolman does not manage', async () => {
        await expect(
          service.restockFromOrder({ ...order, spoolman: [{ consumableId: white.id, spools: 1 }] }, admin),
        ).rejects.toMatchObject({ status: 409 })
      })

      it('refuses more spools than may wait at once', async () => {
        await queue(50)
        await queue(50)
        await queue(50)
        await queue(50)

        await expect(queue(1)).rejects.toMatchObject({ status: 409 })
      })

      it('restocks nothing else from an order whose spools cannot wait', async () => {
        for (let full = 0; full < 4; full++) await queue(50)

        await service
          .restockFromOrder(
            { ...order, restocks: [{ consumableId: white.id, amount: 1_000 }], spoolman: [{ consumableId: black.id, spools: 1 }] },
            admin,
          )
          .catch(() => undefined)

        expect((await level(white.id))?.onHand).toBe(0)
      })

      it('says Spoolman is not connected when it disconnects as spools are ordered', async () => {
        const spools = await repository.listSpoolmanSpools()
        vi.spyOn(repository, 'listSpoolmanSpools').mockImplementation(async () => {
          await service.disconnectSpoolman(admin)
          return spools
        })

        const refused = (await queue(1).catch((error: unknown) => error)) as Response

        expect([refused.status, await refused.text()]).toEqual([409, messagesFor().server.spoolman.restockNotConnected])
      })

      it('queues an order’s spools once when it is sent again after its library change failed', async () => {
        const resend = () =>
          service.restockFromOrder(
            { ...order, prices: [{ consumableId: black.id, price: 22 }], spoolman: [{ consumableId: black.id, spools: 1 }] },
            admin,
          )
        vi.spyOn(repository, 'changeInventory').mockRejectedValueOnce(new Response(null, { status: 409 }))
        await resend().catch(() => undefined)

        await resend()

        expect(await service.spoolmanRestocks(admin)).toHaveLength(1)
      })

      it('queues no spools for an order the library has no room for', async () => {
        await stock(
          'consumables',
          Array.from({ length: MAX_CONSUMABLES - 2 }, (_, index): Consumable => ({
            id: `own-${index}`,
            kind: 'filament',
            name: `Own ${index}`,
            pricePerKg: 18,
          })),
        )
        const queueSpools = vi.spyOn(repository, 'queueSpoolmanRestocks')

        await service
          .restockFromOrder({ ...order, added: [{ ...white, id: 'extra' }], spoolman: [{ consumableId: black.id, spools: 1 }] }, admin)
          .catch(() => undefined)

        expect(queueSpools).not.toHaveBeenCalled()
      })

      it('hands the bridge the spools waiting, oldest first', async () => {
        await queue(1)

        expect(await service.spoolmanRestocksToAdd()).toEqual([expect.objectContaining({ filamentId: 10, grams: 1_000 })])
      })

      it('stops handing the bridge a spool it added', async () => {
        await queue(1)
        const [restock] = await service.spoolmanRestocksToAdd()

        await service.settleSpoolmanRestock({ id: restock.id, spoolId: 5 })

        expect(await service.spoolmanRestocksToAdd()).toEqual([])
      })

      it('shows why Spoolman refused a spool', async () => {
        await queue(1)
        const [restock] = await service.spoolmanRestocksToAdd()

        await service.settleSpoolmanRestock({ id: restock.id, error: 'filament not found' })

        expect((await service.spoolmanRestocks(admin))[0]).toMatchObject({ status: 'failed', error: 'filament not found' })
      })

      it('hands the bridge a refused spool again once retried', async () => {
        await queue(1)
        const [restock] = await service.spoolmanRestocksToAdd()
        await service.settleSpoolmanRestock({ id: restock.id, error: 'offline' })

        await service.retrySpoolmanRestock(restock.id, admin)

        expect(await service.spoolmanRestocksToAdd()).toHaveLength(1)
      })

      it('refuses a report for a spool it never queued', async () => {
        await expect(service.settleSpoolmanRestock({ id: 'missing', spoolId: 5 })).rejects.toMatchObject({ status: 404 })
      })

      it('removes a waiting spool', async () => {
        await queue(1)
        const [restock] = await service.spoolmanRestocksToAdd()

        await service.removeSpoolmanRestock(restock.id, admin)

        expect(await service.spoolmanRestocks(admin)).toEqual([])
      })

      it('lets only admins remove a waiting spool', async () => {
        await queue(1)
        const [restock] = await service.spoolmanRestocksToAdd()

        await expect(service.removeSpoolmanRestock(restock.id, requester)).rejects.toMatchObject({ status: 403 })
      })

      it('captures queued spools with counts only', async () => {
        capture.mockClear()

        await queue()

        expect(capture).toHaveBeenCalledWith(admin.id, 'order_restock_recorded', {
          vendor: 'bambu-lab',
          restock_count: 0,
          added_count: 0,
          price_count: 0,
          spoolman_spool_count: 2,
        })
      })
    })
  })

  describe('restocking from an order', () => {
    const grey: Consumable = {
      id: 'basic-grey',
      kind: 'filament',
      name: 'Bambu Lab PLA Basic · Gray',
      filamentPresetId: 'filament-bambu-lab-pla',
      colour: { name: 'Gray', hex: '#8E9089' },
      pricePerKg: 20,
    }
    const jade: Consumable = {
      id: 'basic-jade',
      kind: 'filament',
      name: 'Bambu Lab PLA Basic · Jade White',
      filamentPresetId: 'filament-bambu-lab-pla',
      colour: { name: 'Jade White', hex: '#FFFFFF' },
      pricePerKg: 16.99,
    }
    const order = { vendor: 'bambu-lab' as const, added: [], prices: [], restocks: [{ consumableId: grey.id, amount: 2_000 }] }
    const onHand = async (id: string) => (await service.stockLevels(admin)).find((level) => level.consumableId === id)?.onHand

    beforeEach(async () => {
      await stock('consumables', [grey])
      await repository.setSetting(USAGE_TRACKING_SETTING, true)
    })

    it('restocks each line', async () => {
      await service.restockFromOrder(order, admin)

      expect(await onHand(grey.id)).toBe(2_000)
    })

    it('records the lines as one undoable step', async () => {
      const { transactionId } = await service.restockFromOrder(
        { ...order, added: [jade], restocks: [...order.restocks, { consumableId: jade.id, amount: 1_000 }] },
        admin,
      )
      await service.undoUsage(transactionId!, admin)

      expect([await onHand(grey.id), await onHand(jade.id)]).toEqual([0, 0])
    })

    it('adds a new filament to the library', async () => {
      await service.restockFromOrder({ ...order, added: [jade], restocks: [{ consumableId: jade.id, amount: 1_000 }] }, admin)

      expect((await repository.listInventory('consumables')).map(({ id }) => id)).toEqual([grey.id, jade.id])
    })

    it('updates the prices it was given before restocking at them', async () => {
      const { events } = await service.restockFromOrder({ ...order, prices: [{ consumableId: grey.id, price: 16.99 }] }, admin)

      expect(events[0].unitPrice).toBeCloseTo(0.01699)
    })

    it('leaves prices it was not given', async () => {
      await service.restockFromOrder(order, admin)

      expect((await repository.listInventory('consumables')).find(({ id }) => id === grey.id)).toMatchObject({ pricePerKg: 20 })
    })

    it('refuses a consumable the library lacks', async () => {
      await expect(service.restockFromOrder({ ...order, restocks: [{ consumableId: 'missing', amount: 1 }] }, admin)).rejects.toMatchObject(
        {
          status: 400,
        },
      )
    })

    it('refuses a filament Spoolman manages', async () => {
      await service.connectSpoolman('hash', admin)
      await service.receiveSpoolman({
        replace: [
          {
            id: 1,
            filamentId: 10,
            vendor: 'Bambu Lab',
            material: 'PLA',
            externalId: 'bambulab_pla_gray_1000_175_n',
            remainingGrams: 600,
            archived: false,
          },
        ],
      })

      await expect(service.restockFromOrder(order, admin)).rejects.toMatchObject({ status: 409 })
    })

    it('refuses a new filament Spoolman would manage, adding nothing', async () => {
      await service.connectSpoolman('hash', admin)
      await service.receiveSpoolman({
        replace: [
          {
            id: 1,
            filamentId: 10,
            vendor: 'Bambu Lab',
            material: 'PLA',
            externalId: 'bambulab_pla_jadewhite_1000_175_n',
            remainingGrams: 600,
            archived: false,
          },
        ],
      })
      await service
        .restockFromOrder({ ...order, added: [jade], restocks: [{ consumableId: jade.id, amount: 1_000 }] }, admin)
        .catch(() => undefined)

      expect((await repository.listInventory('consumables')).map(({ id }) => id)).toEqual([grey.id])
    })

    it('lets only admins restock', async () => {
      await expect(service.restockFromOrder(order, requester)).rejects.toMatchObject({ status: 403 })
    })

    it('counts what it recorded for telemetry', async () => {
      await service.restockFromOrder(
        {
          ...order,
          added: [jade],
          prices: [{ consumableId: grey.id, price: 16.99 }],
          restocks: [...order.restocks, { consumableId: jade.id, amount: 1_000 }],
        },
        admin,
      )

      expect(capture).toHaveBeenCalledWith(admin.id, 'order_restock_recorded', {
        vendor: 'bambu-lab',
        restock_count: 2,
        added_count: 1,
        price_count: 1,
      })
    })
  })

  describe('print-ready notifications', () => {
    let printsReady: Mock<Notifier['printsReady']>
    let canSend: boolean

    beforeEach(async () => {
      printsReady = vi.fn(async () => undefined)
      canSend = true
      service = new STLQuestService(
        repository,
        assets,
        staging,
        eventBus(),
        telemetry,
        { remove: removeTusUpload },
        async () => undefined,
        { canSend: async () => canSend, printsReady },
      )
      await repository.addWorkspaceMember(admin.id, 'owner')
      await repository.addWorkspaceMember(requester.id, 'member')
    })

    it('emails the requester when copies reach Ready', async () => {
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
      expect(printsReady).toHaveBeenCalledWith({ id: requester.id, email: requester.email, name: requester.name }, [
        { name: 'Model', count: 1 },
      ])
    })

    it('skips the requesters when nothing can send', async () => {
      canSend = false
      const preferences = vi.spyOn(repository, 'notificationPreferences')
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
      expect(preferences).not.toHaveBeenCalled()
    })

    it('does not email for moves to earlier stages', async () => {
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'post_processing', count: 1 }, admin)
      expect(printsReady).not.toHaveBeenCalled()
    })

    it('does not email requesters who moved their own prints', async () => {
      await repository.addWorkspaceMember(requester.id, 'admin')
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, { ...requester, role: 'admin' })
      expect(printsReady).not.toHaveBeenCalled()
    })

    it('does not email requesters who opted out', async () => {
      await service.setNotificationPreference('print-ready', false, requester)
      const id = await request()
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
      expect(printsReady).not.toHaveBeenCalled()
    })

    it('does not email requesters who left the workspace', async () => {
      const id = await request()
      await repository.removeWorkspaceMember(requester.id)
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1 }, admin)
      expect(printsReady).not.toHaveBeenCalled()
    })

    it('sends one email per requester for a batch move', async () => {
      const first = await request()
      const second = await repository.createRequest({
        name: 'Hinge',
        quantity: 2,
        ownerUserId: requester.id,
        sourceUrl: 'https://example.com/hinge',
      })
      await service.moveCopiesBatch(
        [
          { id: first, from: 'todo', to: 'done', count: 1 },
          { id: second, from: 'todo', to: 'done', count: 2 },
        ],
        admin,
      )
      expect(printsReady.mock.calls).toEqual([
        [
          { id: requester.id, email: requester.email, name: requester.name },
          [
            { name: 'Model', count: 1 },
            { name: 'Hinge', count: 2 },
          ],
        ],
      ])
    })

    it('emails the requester when a print group reaches Ready', async () => {
      const id = await request()
      const groupId = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
      await service.moveGroup(groupId, 'todo', 'done', admin)
      expect(printsReady).toHaveBeenCalledWith({ id: requester.id, email: requester.email, name: requester.name }, [
        { name: 'Model', count: 1 },
      ])
    })

    it('emails the requester when a grouped copy moves to Ready', async () => {
      const id = await request()
      const groupId = await service.createGroup({ name: 'Plate', status: 'todo', items: [{ requestId: id, count: 1 }] }, admin)
      await service.moveCopies({ id, from: 'todo', to: 'done', count: 1, tagIds: [groupId] }, admin)
      expect(printsReady).toHaveBeenCalledWith({ id: requester.id, email: requester.email, name: requester.name }, [
        { name: 'Model', count: 1 },
      ])
    })

    it('rejects preference changes from non-members', async () => {
      await expect(service.setNotificationPreference('print-ready', false, otherRequester)).rejects.toMatchObject({ status: 403 })
    })
  })
})
