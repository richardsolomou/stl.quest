import argon2 from 'argon2'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repository } from '../core/types'

const getRequestHeader = vi.fn<(name: string) => string | undefined>()
const getCookie = vi.fn<() => string | undefined>()
const setCookie = vi.fn()
vi.mock('@tanstack/react-start/server', () => ({
  deleteCookie: vi.fn(),
  getCookie,
  getRequestHeader,
  getRequestProtocol: () => 'https',
  setCookie,
}))

const repository = {
  findUserByEmail: () => undefined,
  passwordHash: () => undefined,
} as unknown as Repository

describe('authentication guards', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    getRequestHeader.mockReset()
    getCookie.mockReset()
    setCookie.mockReset()
    delete process.env.TRUSTED_PROXY_SECRET
  })

  it('runs the dummy verifier for an unknown user and bounds input', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const verify = vi.spyOn(argon2, 'verify').mockResolvedValue(false)
    const auth = new LocalAuthProvider(repository)
    await expect(auth.login({ email: 'unknown-a@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 })
    expect(verify).toHaveBeenCalledOnce()
    await expect(auth.login({ email: 'x'.repeat(255), password: 'wrong' })).rejects.toMatchObject({ status: 401 })
    expect(verify).toHaveBeenCalledOnce()
  })

  it('rate limits repeated password verification attempts', async () => {
    const { LocalAuthProvider } = await import('./auth')
    vi.spyOn(argon2, 'verify').mockResolvedValue(false)
    const auth = new LocalAuthProvider(repository)
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(auth.login({ email: 'limited@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 })
    }
    await expect(auth.login({ email: 'limited@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 429 })
  })

  it('reserves per-account attempts before concurrent verification completes', async () => {
    const { LocalAuthProvider } = await import('./auth')
    let release!: (valid: boolean) => void
    const pending = new Promise<boolean>((resolve) => { release = resolve })
    vi.spyOn(argon2, 'verify').mockImplementation(() => pending)
    const auth = new LocalAuthProvider(repository)
    const first = Array.from({ length: 2 }, () => auth.login({ email: 'concurrent@example.com', password: 'wrong' }).catch((error) => error))
    await expect(auth.login({ email: 'concurrent@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 429 })
    release(false)
    await Promise.all(first)
    await expect(auth.login({ email: 'concurrent@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 })
  })

  it('does not hash setup passwords after bootstrap is complete', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const hash = vi.spyOn(argon2, 'hash')
    const auth = new LocalAuthProvider({ countUsers: () => 1 } as unknown as Repository)
    await expect(auth.setup({ email: 'new@example.com', name: 'New', password: 'long-enough-password' })).rejects.toMatchObject({ status: 409 })
    expect(hash).not.toHaveBeenCalled()
  })

  it('allows only one expensive setup hash at a time', async () => {
    const { LocalAuthProvider } = await import('./auth')
    let release!: (hash: string) => void
    vi.spyOn(argon2, 'hash').mockImplementation(() => new Promise<string>((resolve) => { release = resolve }))
    const setupRepository = { countUsers: () => 0, createFirstUser: () => ({ id: 'first', email: 'first@example.com', name: 'First', role: 'operator' as const }), createSession: vi.fn() } as unknown as Repository
    const auth = new LocalAuthProvider(setupRepository)
    const first = auth.setup({ email: 'first@example.com', name: 'First', password: 'long-enough-password' })
    await expect(auth.setup({ email: 'second@example.com', name: 'Second', password: 'long-enough-password' })).rejects.toMatchObject({ status: 429 })
    release('hash')
    await expect(first).resolves.toMatchObject({ email: 'first@example.com' })
  })

  it('lets the first visitor claim the operator account', async () => {
    const { LocalAuthProvider } = await import('./auth')
    vi.spyOn(argon2, 'hash').mockResolvedValue('hash')
    const setupRepository = { countUsers: () => 0, createFirstUser: () => ({ id: 'first', email: 'first@example.com', name: 'First', role: 'operator' as const }), createSession: vi.fn() } as unknown as Repository
    const auth = new LocalAuthProvider(setupRepository)
    await expect(auth.setup({ email: 'first@example.com', name: 'First', password: 'long-enough-password' })).resolves.toMatchObject({ role: 'operator' })
  })

  it('enforces the eight character password floor', async () => {
    const { hashPassword } = await import('./auth')
    vi.spyOn(argon2, 'hash').mockResolvedValue('hash')
    await expect(hashPassword('seven77')).rejects.toMatchObject({ status: 400 })
    await expect(hashPassword('eight888')).resolves.toBe('hash')
  })

  it('bounds password hashes shared by setup, password changes, and user creation', async () => {
    const { hashPassword } = await import('./auth')
    const releases: Array<(hash: string) => void> = []
    vi.spyOn(argon2, 'hash').mockImplementation(() => new Promise<string>((resolve) => { releases.push(resolve) }))
    const first = hashPassword('first-long-password')
    const second = hashPassword('second-long-password')
    await expect(hashPassword('third-long-password')).rejects.toMatchObject({ status: 429 })
    releases.forEach((release) => release('hash'))
    await expect(Promise.all([first, second])).resolves.toEqual(['hash', 'hash'])
  })

  it('shares the Argon2 concurrency bound across verification and hashing', async () => {
    const { hashPassword, LocalAuthProvider } = await import('./auth')
    let release!: (valid: boolean) => void
    vi.spyOn(argon2, 'verify').mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))
    const auth = new LocalAuthProvider(repository)
    const verifying = auth.login({ email: 'cross-operation@example.com', password: 'wrong' }).catch(() => undefined)
    let releaseHash!: (hash: string) => void
    vi.spyOn(argon2, 'hash').mockImplementation(() => new Promise<string>((resolve) => { releaseHash = resolve }))
    const hashing = hashPassword('cross-operation-password')
    await expect(hashPassword('rejected-third-operation')).rejects.toMatchObject({ status: 429 })
    release(false)
    releaseHash('hash')
    await Promise.all([verifying, hashing])
  })

  it('does not charge login budgets when the Argon2 permit is busy', async () => {
    const { LocalAuthProvider } = await import('./auth')
    let release!: (valid: boolean) => void
    const held = new Promise<boolean>((resolve) => { release = resolve })
    const verify = vi.spyOn(argon2, 'verify').mockImplementation(() => held)
    const auth = new LocalAuthProvider(repository)
    const first = auth.login({ email: 'holder-one@example.com', password: 'wrong' }).catch(() => undefined)
    const second = auth.login({ email: 'holder-two@example.com', password: 'wrong' }).catch(() => undefined)
    for (let request = 0; request < 60; request++) {
      await expect(auth.login({ email: 'busy-budget@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 429 })
    }
    release(false)
    await Promise.all([first, second])
    await expect(auth.login({ email: 'busy-budget@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 })
    expect(verify).toHaveBeenCalledTimes(3)
  })

  it('does not issue a stale login session after a concurrent password rotation', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const { SqliteRepository } = await import('./sqlite')
    const sqlite = new SqliteRepository(new Database(':memory:'))
    const user = sqlite.createUser({ email: 'stale-login@example.com', name: 'Owner', passwordHash: 'old-hash', role: 'operator' })
    const currentToken = 'current-token'
    sqlite.createSession({ tokenHash: crypto.createHash('sha256').update(currentToken).digest('hex'), userId: user.id, expiresAt: Date.now() + 60_000 })
    getCookie.mockReturnValue(currentToken)
    let releaseLogin!: (valid: boolean) => void
    const loginVerification = new Promise<boolean>((resolve) => { releaseLogin = resolve })
    vi.spyOn(argon2, 'verify').mockImplementation((_hash, password) => password === 'login-password' ? loginVerification : Promise.resolve(true))
    vi.spyOn(argon2, 'hash').mockResolvedValue('rotated-hash')
    const auth = new LocalAuthProvider(sqlite)
    const loggingIn = auth.login({ email: user.email, password: 'login-password' })
    await vi.waitFor(() => expect(argon2.verify).toHaveBeenCalled())
    await auth.changePassword({ currentPassword: 'current-password', newPassword: 'rotated-password' })
    releaseLogin(true)
    await expect(loggingIn).rejects.toMatchObject({ status: 409 })
    expect(sqlite.passwordHash(user.id)).toBe('rotated-hash')
    expect(setCookie).toHaveBeenCalledOnce()
    sqlite.close()
  })

  it('allows only one concurrent password rotation verified against the same hash', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const { SqliteRepository } = await import('./sqlite')
    const sqlite = new SqliteRepository(new Database(':memory:'))
    const user = sqlite.createUser({ email: 'competing-rotation@example.com', name: 'Owner', passwordHash: 'old-hash', role: 'operator' })
    const currentToken = 'rotation-token'
    sqlite.createSession({ tokenHash: crypto.createHash('sha256').update(currentToken).digest('hex'), userId: user.id, expiresAt: Date.now() + 60_000 })
    getCookie.mockReturnValue(currentToken)
    vi.spyOn(argon2, 'verify').mockResolvedValue(true)
    const hashResolvers: Array<(hash: string) => void> = []
    vi.spyOn(argon2, 'hash').mockImplementation(() => new Promise<string>((resolve) => { hashResolvers.push(resolve) }))
    const auth = new LocalAuthProvider(sqlite)
    const first = auth.changePassword({ currentPassword: 'current-password', newPassword: 'first-new-password' })
    const second = auth.changePassword({ currentPassword: 'current-password', newPassword: 'second-new-password' })
    await vi.waitFor(() => expect(hashResolvers).toHaveLength(2))
    hashResolvers[0]('first-hash')
    hashResolvers[1]('second-hash')
    const results = await Promise.allSettled([first, second])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ status: 409 })
    expect(['first-hash', 'second-hash']).toContain(sqlite.passwordHash(user.id))
    expect(setCookie).toHaveBeenCalledOnce()
    sqlite.close()
  })

  it('changes a local password and invalidates other sessions', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const { SqliteRepository } = await import('./sqlite')
    const sqlite = new SqliteRepository(new Database(':memory:'))
    const user = sqlite.createUser({ email: 'owner@example.com', name: 'Owner', passwordHash: 'old-hash', role: 'operator' })
    const oldToken = 'old-token'
    sqlite.createSession({ tokenHash: crypto.createHash('sha256').update(oldToken).digest('hex'), userId: user.id, expiresAt: Date.now() + 60_000 })
    sqlite.createSession({ tokenHash: 'another-session', userId: user.id, expiresAt: Date.now() + 60_000 })
    getCookie.mockReturnValue(oldToken)
    vi.spyOn(argon2, 'verify').mockResolvedValue(true)
    vi.spyOn(argon2, 'hash').mockResolvedValue('new-hash')
    await new LocalAuthProvider(sqlite).changePassword({ currentPassword: 'old password', newPassword: 'new-password-long' })
    expect(sqlite.passwordHash(user.id)).toBe('new-hash')
    expect(sqlite.findSession('another-session')).toBeUndefined()
    expect(setCookie).toHaveBeenCalledOnce()
    sqlite.close()
  })

  it('does not set a replacement cookie when atomic password rotation fails', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const { SqliteRepository } = await import('./sqlite')
    const sqlite = new SqliteRepository(new Database(':memory:'))
    const user = sqlite.createUser({ email: 'failure@example.com', name: 'Owner', passwordHash: 'old-hash', role: 'operator' })
    const token = 'failure-token'
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    sqlite.createSession({ tokenHash, userId: user.id, expiresAt: Date.now() + 60_000 })
    getCookie.mockReturnValue(token)
    vi.spyOn(argon2, 'verify').mockResolvedValue(true)
    vi.spyOn(argon2, 'hash').mockResolvedValue('new-hash')
    vi.spyOn(sqlite, 'rotatePasswordSession').mockImplementation(() => { throw new Error('database full') })
    await expect(new LocalAuthProvider(sqlite).changePassword({ currentPassword: 'old password', newPassword: 'new-password-long' })).rejects.toThrow('database full')
    expect(sqlite.passwordHash(user.id)).toBe('old-hash')
    expect(sqlite.findSession(tokenHash)).toEqual(user)
    expect(setCookie).not.toHaveBeenCalled()
    sqlite.close()
  })

  it('rate limits password changes per account without consuming the login verifier budget', async () => {
    const { LocalAuthProvider } = await import('./auth')
    const { SqliteRepository } = await import('./sqlite')
    const sqlite = new SqliteRepository(new Database(':memory:'))
    const user = sqlite.createUser({ email: 'change-limit@example.com', name: 'Owner', passwordHash: 'old-hash', role: 'operator' })
    const token = 'change-limit-token'
    sqlite.createSession({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: Date.now() + 60_000 })
    getCookie.mockReturnValue(token)
    const verify = vi.spyOn(argon2, 'verify').mockResolvedValue(false)
    const auth = new LocalAuthProvider(sqlite)
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(auth.changePassword({ currentPassword: 'wrong password', newPassword: 'new-password-long' })).rejects.toMatchObject({ status: 403 })
    }
    await expect(auth.changePassword({ currentPassword: 'wrong password', newPassword: 'new-password-long' })).rejects.toMatchObject({ status: 429 })
    await expect(auth.login({ email: 'separate-login@example.com', password: 'wrong' })).rejects.toMatchObject({ status: 401 })
    expect(verify).toHaveBeenCalledTimes(6)
    sqlite.close()
  })

  it('fails trusted-header authentication closed without the proxy proof', async () => {
    const { TrustedHeaderAuthProvider } = await import('./auth')
    process.env.TRUSTED_PROXY_SECRET = 'configured-secret-at-least-24'
    getRequestHeader.mockImplementation((name) => name === 'X-PrintHub-Proxy-Secret' ? 'spoofed' : 'attacker@example.com')
    expect(() => new TrustedHeaderAuthProvider(repository).current()).toThrow(expect.objectContaining({ status: 403 }))
  })

  it('rejects the documented trusted-proxy placeholder', async () => {
    const { TrustedHeaderAuthProvider } = await import('./auth')
    process.env.TRUSTED_PROXY_SECRET = 'replace-with-at-least-24-random-characters'
    getRequestHeader.mockImplementation((name) => name === 'X-PrintHub-Proxy-Secret' ? process.env.TRUSTED_PROXY_SECRET : 'operator@example.com')
    expect(() => new TrustedHeaderAuthProvider(repository).current()).toThrow(expect.objectContaining({ status: 503 }))
  })
})
