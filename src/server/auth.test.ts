import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteRepository } from '../adapters/sqlite'
import { createAuth } from './auth'

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'

function build() {
  const repository = new SqliteRepository(new Database(':memory:'))
  const auth = createAuth(repository.database, SECRET)
  return { repository, auth }
}

// Turns the set-cookie headers from one auth response into request headers
// for the next call, the way a browser would.
function cookieHeaders(headers: Headers) {
  const cookies = headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  return new Headers({ cookie: cookies })
}

describe('better-auth integration', () => {
  let cleanup: (() => void) | undefined
  afterEach(() => cleanup?.())

  it('gives the first sign-up the operator role and closes sign-up afterwards', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'first@example.com', password: 'password123', name: 'First' },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({ headers: cookieHeaders(headers) })
    expect(session?.user).toMatchObject({ email: 'first@example.com', role: 'operator' })

    await expect(auth.api.signUpEmail({
      body: { email: 'second@example.com', password: 'password123', name: 'Second' },
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })
    expect(repository.countUsers()).toBe(1)
  })

  it('lets operators create users with roles, but not requesters', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password123', name: 'Op' },
      returnHeaders: true,
    })
    const operator = cookieHeaders(headers)
    await auth.api.createUser({
      body: { email: 'maker@example.com', password: 'password123', name: 'Maker', role: 'requester' },
      headers: operator,
    })
    expect(repository.listUsers()).toMatchObject([
      { email: 'maker@example.com', role: 'requester' },
      { email: 'op@example.com', role: 'operator' },
    ])

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'password123' },
      returnHeaders: true,
    })
    await expect(auth.api.createUser({
      body: { email: 'sneak@example.com', password: 'password123', name: 'Sneak', role: 'operator' },
      headers: cookieHeaders(makerHeaders),
    })).rejects.toMatchObject({ status: 'FORBIDDEN' })
  })

  it('operator-set passwords plus session revocation lock out old sessions', async () => {
    const { repository, auth } = build()
    cleanup = () => repository.close()

    const { headers } = await auth.api.signUpEmail({
      body: { email: 'op@example.com', password: 'password123', name: 'Op' },
      returnHeaders: true,
    })
    const operator = cookieHeaders(headers)
    const created = await auth.api.createUser({
      body: { email: 'maker@example.com', password: 'first-password', name: 'Maker', role: 'requester' },
      headers: operator,
    })

    const { headers: makerHeaders } = await auth.api.signInEmail({
      body: { email: 'maker@example.com', password: 'first-password' },
      returnHeaders: true,
    })
    const makerSession = cookieHeaders(makerHeaders)
    expect(await auth.api.getSession({ headers: makerSession })).not.toBeNull()

    await auth.api.setUserPassword({ body: { userId: created.user.id, newPassword: 'second-password' }, headers: operator })
    await auth.api.revokeUserSessions({ body: { userId: created.user.id }, headers: operator })

    expect(await auth.api.getSession({ headers: makerSession })).toBeNull()
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'first-password' } }))
      .rejects.toMatchObject({ status: 'UNAUTHORIZED' })
    await expect(auth.api.signInEmail({ body: { email: 'maker@example.com', password: 'second-password' } })).resolves.toBeTruthy()
  })
})
