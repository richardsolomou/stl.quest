import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Identity } from '../core/types'
import { changePassword, createUser, logout } from '../server/fns'
import { useEscape } from '../lib/useEscape'

type View = 'menu' | 'password' | 'user'

export function SettingsModal({ me, localAuth, onClose }: { me: Identity; localAuth: boolean; onClose: () => void }) {
  const [view, setView] = useState<View>('menu')
  useEscape(() => (view === 'menu' ? onClose() : setView('menu')))

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog dialog-small">
        {view === 'menu' && <SettingsMenu me={me} localAuth={localAuth} onClose={onClose} onView={setView} />}
        {view === 'password' && <ChangePasswordForm onBack={() => setView('menu')} onDone={onClose} />}
        {view === 'user' && <CreateUserForm onBack={() => setView('menu')} />}
      </div>
    </div>
  )
}

function SettingsMenu({ me, localAuth, onClose, onView }: { me: Identity; localAuth: boolean; onClose: () => void; onView: (view: View) => void }) {
  const callLogout = useServerFn(logout)
  return (
    <>
      <h2>Settings</h2>
      <section className="settings-section">
        <h3>Account</h3>
        <p className="settings-identity">
          {me.name} <span className="settings-dim">({me.email})</span>
          <span className="chip settings-role">{me.role}</span>
        </p>
        {localAuth && (
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => onView('password')}>Change password</button>
            <button type="button" className="btn sign-out" onClick={async () => { await callLogout(); window.location.reload() }}>Sign out</button>
          </div>
        )}
      </section>
      {localAuth && me.role === 'operator' && (
        <section className="settings-section">
          <h3>Users</h3>
          <div className="settings-actions">
            <button type="button" className="btn" onClick={() => onView('user')}>Add user</button>
          </div>
        </section>
      )}
      <section className="settings-section">
        <h3>About</h3>
        <p className="settings-dim">PrintHub v{__APP_VERSION__} · {localAuth ? 'built-in accounts' : 'trusted-header identity'}</p>
      </section>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </>
  )
}

function ChangePasswordForm({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const callChangePassword = useServerFn(changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callChangePassword({ data: { currentPassword, newPassword } })
      onDone()
    } catch {
      setError('Could not change your password. Check your current password and use at least 8 characters.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Change password</h2>
      <div className="field"><label htmlFor="current-password">Current password</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" required /></div>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onBack}>Back</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button></div>
    </form>
  )
}

function CreateUserForm({ onBack }: { onBack: () => void }) {
  const callCreateUser = useServerFn(createUser)
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'requester' | 'operator'>('requester')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callCreateUser({ data: { email, name, password, role } })
      await queryClient.invalidateQueries({ queryKey: ['people'] })
      onBack()
    } catch {
      setError('Could not create this user. Check the fields and email address.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Add user</h2>
      <div className="field"><label htmlFor="user-name">Name</label><input id="user-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></div>
      <div className="field"><label htmlFor="user-email">Email</label><input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
      <div className="field"><label htmlFor="user-password">Initial password</label><input id="user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={256} required /></div>
      <div className="field"><label htmlFor="user-role">Role</label><select id="user-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="requester">Requester</option><option value="operator">Operator</option></select></div>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="btn" onClick={onBack}>Back</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form>
  )
}
