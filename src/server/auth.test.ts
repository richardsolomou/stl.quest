import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import type { EmailDelivery, EmailMessage } from '../adapters/email'
import { createDatabase } from '../db'
import { DrizzleRepository } from '../db/repository'
import { account, user } from '../db/schema'
import { createAuth } from './auth'
import { withAuthInvite, withAuthProvisioning } from './authInvite'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

function decodeBase32(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const bits = value
    .split('')
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0'))
    .join('')
  return Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []).toString()
}

function build(options?: { onUserDeleting?: (userId: string) => Promise<void> }) {
  const repository = new DrizzleRepository(createDatabase(':memory:'))
  const auth = createAuth(repository.database, SECRET, {
    claimInvite: (token, email) => repository.claimInviteGlobally(hashToken(token), Date.now(), email),
    completeInvite: (id, userId) => repository.completeInviteGlobally(id, userId),
    onUserDeleting: options?.onUserDeleting,
  })
  return { repository, auth }
}

// Turns the set-cookie headers from one auth response into request headers
// for the next call, the way a browser would.
function cookieHeaders(headers: Headers) {
  const cookies = headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
  return new Headers({ cookie: cookies })
}

function mergeCookieHeaders(current: Headers, response: Headers) {
  const cookies = new Map(
    (current.get('cookie') ?? '')
      .split('; ')
      .filter(Boolean)
      .map((cookie) => cookie.split(/=(.*)/s).slice(0, 2) as [string, string]),
  )
  for (const cookie of response.getSetCookie()) {
    const [name, value] = cookie.split(';')[0].split(/=(.*)/s).slice(0, 2)
    cookies.set(name, value)
  }
  return new Headers({ cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') })
}

function createUser(auth: ReturnType<typeof createAuth>, input: Parameters<typeof auth.api.createUser>[0]) {
  return withAuthProvisioning(() => auth.api.createUser(input))
}

function listAccounts(repository: DrizzleRepository) {
  return repository.database.select().from(user).all()
}

describe('better-auth integration', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => cleanup?.())

  it('only allows different-email identities through explicit account linking', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    const context = await auth.$context

    expect(context.options.account?.accountLinking).toMatchObject({
      enabled: true,
      disableImplicitLinking: true,
      allowDifferentEmails: true,
    })
  })

  it('requires eight-character passwords for account creation', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    await expect(auth.api.signUpEmail({ body: { email: 'short@example.com', password: '1234567', name: 'Short' } })).rejects.toMatchObject({
      status: 'BAD_REQUEST',
    })
    await expect(auth.api.signUpEmail({ body: { email: 'valid@example.com', password: '12345678', name: 'Valid' } })).resolves.toBeTruthy()
  })

  it('supports optional authenticator-app verification after password sign-in', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    const { headers } = await auth.api.signUpEmail({
      body: { email: 'secure@example.com', password: 'password1234', name: 'Secure' },
      returnHeaders: true,
    })
    const sessionHeaders = cookieHeaders(headers)
    const enrollment = await auth.api.enableTwoFactor({
      body: { password: 'password1234' },
      headers: sessionHeaders,
      returnHeaders: true,
    })
    const encodedSecret = new URL(enrollment.response.totpURI).searchParams.get('secret')
    expect(encodedSecret).toBeTruthy()
    expect(enrollment.response.backupCodes).not.toHaveLength(0)

    const setupCode = await auth.api.generateTOTP({ body: { secret: decodeBase32(encodedSecret!) } })
    const enrollmentHeaders = mergeCookieHeaders(sessionHeaders, enrollment.headers)
    await auth.api.verifyTOTP({ body: { code: setupCode.code }, headers: enrollmentHeaders })

    const signedIn = await auth.api.signInEmail({
      body: { email: 'secure@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    expect(signedIn.response).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: expect.arrayContaining(['totp']) })
    const challengeHeaders = cookieHeaders(signedIn.headers)
    expect(await auth.api.getSession({ headers: challengeHeaders })).toBeNull()

    const verified = await auth.api.verifyBackupCode({
      body: { code: enrollment.response.backupCodes[0] },
      headers: challengeHeaders,
      returnHeaders: true,
    })
    expect(await auth.api.getSession({ headers: cookieHeaders(verified.headers) })).toMatchObject({
      user: { email: 'secure@example.com', twoFactorEnabled: true },
    })
  })

  it('supports password-disabled authentication configurations', async () => {
    const { repository } = build()
    cleanup = () => repository.close()
    const auth = createAuth(repository.database, SECRET, {
      auth: {
        password: false,
        passwordReset: false,
        socialProviders: ['google'],
        google: { enabled: true, clientId: 'client-id', clientSecret: 'client-secret' },
      },
    })
    await expect(
      auth.api.signUpEmail({ body: { email: 'user@example.com', password: 'password1234', name: 'User' } }),
    ).rejects.toMatchObject({
      status: 'BAD_REQUEST',
    })
  })

  it('delivers password reset messages through the email adapter', async () => {
    const { repository } = build()
    cleanup = () => repository.close()
    const messages: EmailMessage[] = []
    const email = {
      send: async (message: EmailMessage) => void messages.push(message),
      verify: async () => undefined,
    } as EmailDelivery
    const auth = createAuth(repository.database, SECRET, { email })
    await auth.api.signUpEmail({ body: { email: 'user@example.com', password: 'password1234', name: 'User' } })

    await auth.api.requestPasswordReset({
      body: { email: 'user@example.com', redirectTo: 'http://localhost/reset-password' },
      headers: new Headers({ origin: 'http://localhost' }),
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ to: 'user@example.com', subject: 'Reset your PrintHub password' })
    expect(messages[0].text).toContain('/reset-password/')
  })

  it('uses the configured base URL for hosted password reset links', async () => {
    const { repository } = build()
    cleanup = () => repository.close()
    const messages: EmailMessage[] = []
    const email = {
      send: async (message: EmailMessage) => void messages.push(message),
      verify: async () => undefined,
    } as EmailDelivery
    const auth = createAuth(repository.database, SECRET, {
      email,
      baseURL: 'https://cloud.printhub.example',
      trustedOrigins: ['https://cloud.printhub.example'],
    })
    await auth.api.signUpEmail({ body: { email: 'user@example.com', password: 'password1234', name: 'User' } })

    await auth.api.requestPasswordReset({
      body: { email: 'user@example.com', redirectTo: 'https://cloud.printhub.example/reset-password' },
      headers: new Headers({ origin: 'https://cloud.printhub.example', host: 'attacker.example' }),
    })

    expect(messages[0].text).toContain('https://cloud.printhub.example/api/auth/reset-password/')
    expect(messages[0].text).not.toContain('attacker.example')
  })

  it('lets a social-only user create a first password for their account email', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    const { headers } = await auth.api.signUpEmail({
      body: { email: 'social@example.com', password: 'password1234', name: 'Social' },
      returnHeaders: true,
    })
    const socialUser = cookieHeaders(headers)
    repository.database
      .update(account)
      .set({ providerId: 'google', accountId: 'google-user', password: null })
      .where(eq(account.providerId, 'credential'))
      .run()

    expect(await auth.api.listUserAccounts({ headers: socialUser })).not.toContainEqual(
      expect.objectContaining({ providerId: 'credential' }),
    )
    await auth.api.setPassword({ body: { newPassword: 'new-password1234' }, headers: socialUser })

    expect(await auth.api.listUserAccounts({ headers: socialUser })).toContainEqual(expect.objectContaining({ providerId: 'credential' }))
    await expect(auth.api.signInEmail({ body: { email: 'social@example.com', password: 'new-password1234' } })).resolves.toBeTruthy()
  })

  it('gives the first self-hosted sign-up the admin role and keeps sign-up open', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'first@example.com', password: 'password1234', name: 'First' },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) })
    expect(session?.user).toMatchObject({ email: 'first@example.com', role: 'admin' })

    const second = await auth.api.signUpEmail({
      body: { email: 'second@example.com', password: 'password1234', name: 'Second' },
    })
    expect(second.user).toMatchObject({ email: 'second@example.com', role: 'requester' })
    expect(repository.countUsers()).toBe(2)
  })

  it('lets admins create users with roles, but not requesters', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const admin = cookieHeaders(headers)
    await createUser(auth, {
      body: { email: 'maker@example.com', password: 'password1234', name: 'Maker', role: 'requester' },
      headers: admin,
    })
    expect(listAccounts(repository)).toMatchObject([
      { email: 'op@example.com', role: 'admin' },
      { email: 'maker@example.com', role: 'requester' },
    ])

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    await expect(
      auth.api.createUser({
        body: { email: 'sneak@example.com', password: 'password1234', name: 'Sneak', role: 'admin' },
        headers: cookieHeaders(makerHeaders),
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('runs request cleanup before an admin deletes an account', async () => {
    let cleanedUserId: string | undefined
    const { repository, auth } = build({
      onUserDeleting: async (userId) => {
        cleanedUserId = userId
        for (const request of repository.queryRequests({ ownerUserId: userId }).requests) repository.deleteRequest(request.id)
      },
    })
    cleanup = () => repository.close()
    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const admin = cookieHeaders(headers)
    const created = await createUser(auth, {
      body: { email: 'maker@example.com', password: 'password1234', name: 'Maker', role: 'requester' },
      headers: admin,
    })
    const requestId = repository.createRequest({
      name: 'Model',
      fileName: 'model.stl',
      filePath: 'todo/model.stl',
      quantity: 1,
      ownerUserId: created.user.id,
    })

    await auth.api.removeUser({ body: { userId: created.user.id }, headers: admin })

    expect(cleanedUserId).toBe(created.user.id)
    expect(repository.getRequest(requestId)).toBeUndefined()
    expect(listAccounts(repository)).not.toContainEqual(expect.objectContaining({ id: created.user.id }))
  })

  it('aborts account deletion when request cleanup fails', async () => {
    const { repository, auth } = build({ onUserDeleting: async () => Promise.reject(new Error('storage unavailable')) })
    cleanup = () => repository.close()
    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const admin = cookieHeaders(headers)
    const created = await createUser(auth, {
      body: { email: 'maker@example.com', password: 'password1234', name: 'Maker', role: 'requester' },
      headers: admin,
    })

    await expect(auth.api.removeUser({ body: { userId: created.user.id }, headers: admin })).rejects.toThrow('storage unavailable')

    expect(listAccounts(repository)).toContainEqual(expect.objectContaining({ id: created.user.id }))
  })

  it('admin-set passwords plus session revocation lock out old sessions', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const admin = cookieHeaders(headers)
    const created = await createUser(auth, {
      body: { email: 'maker@example.com', password: 'first-password', name: 'Maker', role: 'requester' },
      headers: admin,
    })

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'first-password' },
      returnHeaders: true,
    })
    const makerSession = cookieHeaders(makerHeaders)
    expect(await auth.api.getSession({ headers: makerSession })).not.toBeNull()

    await auth.api.setUserPassword({ body: { userId: created.user.id, newPassword: 'second-password' }, headers: admin })
    await auth.api.revokeUserSessions({ body: { userId: created.user.id }, headers: admin })

    expect(await auth.api.getSession({ headers: makerSession })).toBeNull()
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'first-password' } })).rejects.toMatchObject({
      status: 'UNAUTHORIZED',
    })
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'second-password' } })).resolves.toBeTruthy()
  })

  it('lets admins promote requesters, but not requesters', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const admin = cookieHeaders(headers)
    const created = await createUser(auth, {
      body: { email: 'maker@example.com', password: 'password1234', name: 'Maker', role: 'requester' },
      headers: admin,
    })
    const other = await createUser(auth, {
      body: { email: 'other@example.com', password: 'password1234', name: 'Other', role: 'requester' },
      headers: admin,
    })

    await auth.api.setRole({ body: { userId: created.user.id, role: 'admin' }, headers: admin })
    expect(listAccounts(repository)).toContainEqual(expect.objectContaining({ email: 'maker@example.com', role: 'admin' }))

    const { headers: otherHeaders } = await auth.api.signInEmail({
      body: { email: 'other@example.com', password: 'password1234' },
      returnHeaders: true,
    })
    await expect(
      auth.api.setRole({ body: { userId: other.user.id, role: 'admin' }, headers: cookieHeaders(otherHeaders) }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('lets admins impersonate any user and return to their own session', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password1234', name: 'Op' },
      returnHeaders: true,
    })
    const adminHeaders = cookieHeaders(headers)
    const created = await createUser(auth, {
      body: { email: 'other-admin@example.com', password: 'password1234', name: 'Other Admin', role: 'admin' },
      headers: adminHeaders,
    })

    const impersonated = await auth.api.impersonateUser({
      body: { userId: created.user.id },
      headers: adminHeaders,
      returnHeaders: true,
    })
    const impersonatedHeaders = mergeCookieHeaders(adminHeaders, impersonated.headers)
    expect(await auth.api.getSession({ headers: impersonatedHeaders })).toMatchObject({
      session: { impersonatedBy: expect.any(String) },
      user: { email: 'other-admin@example.com', role: 'admin' },
    })

    const stopped = await auth.api.stopImpersonating({ headers: impersonatedHeaders, returnHeaders: true })
    const restoredHeaders = mergeCookieHeaders(impersonatedHeaders, stopped.headers)
    expect(await auth.api.getSession({ headers: restoredHeaders })).toMatchObject({
      session: { impersonatedBy: null },
      user: { email: 'op@example.com', role: 'admin' },
    })
  })

  it('uses a valid invite once while allowing other users to create personal accounts', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()
    await auth.api.signUpEmail({ body: { email: 'op@example.com', password: 'password1234', name: 'Op' } })

    repository.createInvite({
      id: 'inv-1',
      tokenHash: hashToken('good-token'),
      role: 'requester',
      recipientEmail: 'customer@example.com',
      expiresAt: Date.now() + 60_000,
    })
    const stranger = await withAuthInvite('wrong-token', () =>
      auth.api.signUpEmail({ body: { email: 'stranger@example.com', password: 'password1234', name: 'Stranger' } }),
    )
    expect(repository.listWorkspacesForUser(stranger.user.id)).toEqual([])

    const wrongRecipient = await withAuthInvite('good-token', () =>
      auth.api.signUpEmail({ body: { email: 'wrong@example.com', password: 'password1234', name: 'Wrong' } }),
    )
    expect(repository.listWorkspacesForUser(wrongRecipient.user.id)).toEqual([])
    expect(repository.findInvite(hashToken('good-token'))?.usedAt).toBeUndefined()

    const { headers } = await withAuthInvite('good-token', () =>
      auth.api.signUpEmail({
        body: { email: 'customer@example.com', password: 'password1234', name: 'Customer' },
        returnHeaders: true,
      }),
    )
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) })
    expect(session?.user).toMatchObject({ email: 'customer@example.com', role: 'requester' })
    repository.ensurePersonalWorkspace(session!.user)
    expect(repository.listWorkspacesForUser(session!.user.id)).toEqual([
      expect.objectContaining({ role: 'owner' }),
      expect.objectContaining({ id: 'test-workspace', role: 'member' }),
    ])

    const tailgater = await withAuthInvite('good-token', () =>
      auth.api.signUpEmail({ body: { email: 'tailgater@example.com', password: 'password1234', name: 'Tailgater' } }),
    )
    expect(repository.listWorkspacesForUser(tailgater.user.id)).toEqual([])

    repository.createInvite({ id: 'inv-2', tokenHash: hashToken('expired-token'), role: 'requester', expiresAt: Date.now() - 1 })
    const late = await withAuthInvite('expired-token', () =>
      auth.api.signUpEmail({ body: { email: 'late@example.com', password: 'password1234', name: 'Late' } }),
    )
    expect(repository.listWorkspacesForUser(late.user.id)).toEqual([])

    repository.createInvite({ id: 'inv-3', tokenHash: hashToken('revoked-token'), role: 'requester', expiresAt: Date.now() + 60_000 })
    repository.deleteInvite('inv-3')
    const revoked = await withAuthInvite('revoked-token', () =>
      auth.api.signUpEmail({ body: { email: 'revoked@example.com', password: 'password1234', name: 'Revoked' } }),
    )
    expect(repository.listWorkspacesForUser(revoked.user.id)).toEqual([])

    expect(repository.countUsers()).toBe(7)
  })

  it('does not let a used invite be revoked back to unused', () => {
    const { repository } = build()
    cleanup = () => repository.close()
    repository.createInvite({ id: 'inv-used', tokenHash: hashToken('token-a'), role: 'requester', expiresAt: Date.now() + 60_000 })
    expect(repository.claimInvite(hashToken('token-a'), Date.now())).toBeTruthy()
    repository.deleteInvite('inv-used')
    expect(repository.findInvite(hashToken('token-a'))?.usedAt).toBeTruthy()
  })
})
