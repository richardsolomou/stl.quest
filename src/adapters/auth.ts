import crypto from 'node:crypto'
import argon2 from 'argon2'
import { deleteCookie, getCookie, getRequestHeader, getRequestProtocol, setCookie } from '@tanstack/react-start/server'
import type { AuthConfig, Identity, Repository } from '../core/types'

const COOKIE = 'printhub_session'
const SESSION_SECONDS = 30 * 24 * 60 * 60
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$O1plDTajjaEDSOJqoJ2Kpg$f54+MMwp/ptDc/R9zeLf+ClYVkVtiZLz+cwB6Fo3Ohk'
const attempts = new Map<string, { count: number; resetAt: number }>()
let verificationWindow = { count: 0, resetAt: 0 }
let activeSetup = 0
let setupWindow = { count: 0, resetAt: 0 }
const passwordChanges = new Map<string, { count: number; resetAt: number }>()
let activePasswordChanges = 0
let passwordChangeWindow = { count: 0, resetAt: 0 }
let hashWindow = { count: 0, resetAt: 0 }
let activeArgon = 0

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

export interface AuthProvider {
  current(): Identity | undefined
  require(): Identity
  setup(input: { email: string; name: string; password: string }): Promise<Identity>
  login(input: { email: string; password: string }): Promise<Identity>
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>
  logout(): void
}

export class LocalAuthProvider implements AuthProvider {
  constructor(private repository: Repository) {}

  current() {
    const token = getCookie(COOKIE)
    return token ? this.repository.findSession(hashToken(token)) : undefined
  }

  require() {
    const identity = this.current()
    if (!identity) throw new Response('unauthenticated', { status: 401 })
    return identity
  }

  // The first person to reach the empty instance claims the operator
  // account (appliance-style first run); keep it private until then.
  async setup(input: { email: string; name: string; password: string }) {
    if (this.repository.countUsers() !== 0) throw new Response('setup complete', { status: 409 })
    validateCredentials(input)
    const now = Date.now()
    if (setupWindow.resetAt <= now) setupWindow = { count: 0, resetAt: now + 60_000 }
    if (activeSetup >= 1 || setupWindow.count >= 5) throw new Response('try again later', { status: 429 })
    activeSetup++
    setupWindow.count++
    let passwordHash: string
    try { passwordHash = await hashPassword(input.password) } finally { activeSetup-- }
    const identity = this.repository.createFirstUser({ email: input.email, name: input.name, passwordHash })
    this.startSession(identity)
    return identity
  }

  async login(input: { email: string; password: string }) {
    if (typeof input.email !== 'string' || typeof input.password !== 'string' || input.email.length > 254 || input.password.length > 256) throw new Response('invalid credentials', { status: 401 })
    const key = input.email.trim().toLowerCase()
    const now = Date.now()
    if (verificationWindow.resetAt <= now) {
      verificationWindow = { count: 0, resetAt: now + 60_000 }
      for (const [attemptKey, attempt] of attempts) if (attempt.resetAt <= now) attempts.delete(attemptKey)
    }
    if (verificationWindow.count >= 60) throw new Response('try again later', { status: 429 })
    const prior = attempts.get(key)
    if (prior && prior.resetAt > now && prior.count >= 5) throw new Response('try again later', { status: 429 })
    const identity = this.repository.findUserByEmail(input.email)
    const hash = identity && this.repository.passwordHash(identity.id)
    let valid = false
    valid = await runArgon(() => {
      const chargedAt = Date.now()
      if (verificationWindow.resetAt <= chargedAt) verificationWindow = { count: 0, resetAt: chargedAt + 60_000 }
      const charged = attempts.get(key)
      const count = charged && charged.resetAt > chargedAt ? charged.count : 0
      if (verificationWindow.count >= 60 || count >= 5) throw new Response('try again later', { status: 429 })
      attempts.set(key, { count: count + 1, resetAt: charged && charged.resetAt > chargedAt ? charged.resetAt : chargedAt + 60_000 })
      verificationWindow.count++
      return argon2.verify(hash ?? DUMMY_HASH, input.password)
    })
    if (!identity || !hash || !valid) {
      throw new Response('invalid credentials', { status: 401 })
    }
    attempts.delete(key)
    const session = this.newSession(identity)
    if (!this.repository.createSessionIfPasswordHash({ ...session, expectedPasswordHash: hash })) {
      throw new Response('credentials changed; try again', { status: 409 })
    }
    this.setSessionCookie(session.token)
    return identity
  }

  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const identity = this.require()
    if (typeof input.currentPassword !== 'string' || typeof input.newPassword !== 'string' || input.currentPassword.length > 256 || input.newPassword.length < 8 || input.newPassword.length > 256) throw new Response('invalid password', { status: 400 })
    const now = Date.now()
    if (passwordChangeWindow.resetAt <= now) passwordChangeWindow = { count: 0, resetAt: now + 60_000 }
    const prior = passwordChanges.get(identity.id)
    const attemptCount = prior && prior.resetAt > now ? prior.count : 0
    if (attemptCount >= 5 || passwordChangeWindow.count >= 20 || activePasswordChanges >= 2) throw new Response('try again later', { status: 429 })
    passwordChanges.set(identity.id, { count: attemptCount + 1, resetAt: prior && prior.resetAt > now ? prior.resetAt : now + 60_000 })
    const existing = this.repository.passwordHash(identity.id)
    activePasswordChanges++
    passwordChangeWindow.count++
    let passwordHash: string
    try {
      if (!existing || !await runArgon(() => argon2.verify(existing, input.currentPassword))) throw new Response('invalid password', { status: 403 })
      passwordHash = await hashPassword(input.newPassword)
    } finally {
      activePasswordChanges--
    }
    passwordChanges.delete(identity.id)
    const session = this.newSession(identity)
    if (!this.repository.rotatePasswordSession({ userId: identity.id, expectedPasswordHash: existing, passwordHash, tokenHash: session.tokenHash, expiresAt: session.expiresAt })) {
      throw new Response('credentials changed; try again', { status: 409 })
    }
    this.setSessionCookie(session.token)
  }

  logout() {
    const token = getCookie(COOKIE)
    if (token) this.repository.deleteSession(hashToken(token))
    deleteCookie(COOKIE, { path: '/' })
  }

  private startSession(identity: Identity) {
    const session = this.newSession(identity)
    this.repository.createSession({ tokenHash: session.tokenHash, userId: identity.id, expiresAt: session.expiresAt })
    this.setSessionCookie(session.token)
    return session.tokenHash
  }

  private newSession(identity: Identity) {
    const token = crypto.randomBytes(32).toString('base64url')
    return { token, tokenHash: hashToken(token), userId: identity.id, expiresAt: Date.now() + SESSION_SECONDS * 1000 }
  }

  private setSessionCookie(token: string) {
    setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: getRequestProtocol() === 'https', path: '/', maxAge: SESSION_SECONDS })
  }
}

export async function hashPassword(password: string) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Response('invalid password', { status: 400 })
  const now = Date.now()
  if (hashWindow.resetAt <= now) hashWindow = { count: 0, resetAt: now + 60_000 }
  if (hashWindow.count >= 20) throw new Response('try again later', { status: 429 })
  hashWindow.count++
  return runArgon(() => argon2.hash(password))
}

async function runArgon<T>(work: () => Promise<T>) {
  if (activeArgon >= 2) throw new Response('server busy', { status: 429 })
  activeArgon++
  try { return await work() } finally { activeArgon-- }
}

export class TrustedHeaderAuthProvider implements AuthProvider {
  constructor(private repository: Repository, private config: Extract<AuthConfig, { provider: 'trusted-header' }>) {}
  current() {
    verifySecret(getRequestHeader('X-PrintHub-Proxy-Secret') ?? '', this.config.proxySecret)
    const email = getRequestHeader(this.config.emailHeader)?.toLowerCase()
    if (!email) return undefined
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) throw new Response('invalid proxy identity', { status: 401 })
    const existing = this.repository.findUserByEmail(email)
    if (existing) return existing
    const operators = this.config.operatorEmails.map((value) => value.toLowerCase().trim())
    return this.repository.createUser({ email, name: email.split('@')[0], role: operators.includes(email) ? 'operator' : 'requester' })
  }
  require() { const identity = this.current(); if (!identity) throw new Response('unauthenticated', { status: 401 }); return identity }
  setup(): Promise<Identity> { throw new Response('disabled', { status: 404 }) }
  login(): Promise<Identity> { throw new Response('disabled', { status: 404 }) }
  changePassword(): Promise<void> { throw new Response('disabled', { status: 404 }) }
  logout() {}
}

function validateCredentials(input: { email: string; name: string; password: string }) {
  if (typeof input.email !== 'string' || typeof input.name !== 'string' || typeof input.password !== 'string' || input.email.length > 254 || input.name.length > 100 || input.password.length > 256 || !/^\S+@\S+\.\S+$/.test(input.email) || !input.name.trim() || input.password.length < 8) {
    throw new Response('use a valid email, name, and password of at least 8 characters', { status: 400 })
  }
}

function verifySecret(provided: string, configured: string | undefined) {
  if (!configured || configured.length < 24 || configured === 'replace-with-at-least-24-random-characters') throw new Response('authentication is not configured', { status: 503 })
  if (typeof provided !== 'string' || provided.length > 512) throw new Response('forbidden', { status: 403 })
  const left = Buffer.from(provided)
  const right = Buffer.from(configured)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Response('forbidden', { status: 403 })
}
