import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { Identity, StorageConfig } from '../core/types'
import { changePassword, createUser, logout, setUserPassword, updateBoardSettings, updateStorageSettings, updateTelemetrySettings } from '../server/fns'
import { boardQuery, storageQuery, telemetryQuery, usersQuery } from '../lib/queries'

type Pane = 'account' | 'board' | 'users' | 'storage' | 'telemetry' | 'about'

// Rendered for operators only; the /settings route redirects requesters.
export function SettingsPanes({ me }: { me: Identity }) {
  const [pane, setPane] = useState<Pane>('account')
  const panes: { id: Pane; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'board', label: 'Board' },
    { id: 'users', label: 'Users' },
    { id: 'storage', label: 'Storage' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'about', label: 'About' },
  ]

  return (
    <div className="settings-body">
      <nav className="settings-nav" aria-label="Settings sections">
        {panes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${pane === item.id ? ' active' : ''}`}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        {pane === 'account' && <AccountPane me={me} />}
        {pane === 'board' && <BoardPane />}
        {pane === 'users' && <UsersPane me={me} />}
        {pane === 'storage' && <StoragePane />}
        {pane === 'telemetry' && <TelemetryPane />}
        {pane === 'about' && <AboutPane />}
      </div>
    </div>
  )
}

function AccountPane({ me }: { me: Identity }) {
  const callLogout = useServerFn(logout)
  return (
    <>
      <h3>Account</h3>
      <p className="settings-identity">
        {me.name} <span className="settings-dim">({me.email})</span>
        <span className="chip settings-role">{me.role}</span>
      </p>
      <ChangePasswordForm />
      <div className="settings-actions">
        <button type="button" className="btn sign-out" onClick={async () => { await callLogout(); window.location.reload() }}>Sign out</button>
      </div>
    </>
  )
}

function ChangePasswordForm() {
  const callChangePassword = useServerFn(changePassword)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await callChangePassword({ data: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      setSaved(true)
    } catch {
      setError('Could not change your password. Check your current password and use at least 8 characters.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="field"><label htmlFor="current-password">Current password</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} maxLength={256} autoComplete="current-password" required /></div>
      <div className="field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" required /></div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Password changed.</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
    </form>
  )
}

function BoardPane() {
  const { data: current } = useQuery(boardQuery())
  const callUpdate = useServerFn(updateBoardSettings)
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!current) return <h3>Board</h3>

  const save = async (privateRequests: boolean) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await callUpdate({ data: { privateRequests } })
      await queryClient.invalidateQueries()
      setSaved(true)
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : ''
      setError(message || 'Could not save board settings.')
    }
    setBusy(false)
  }

  return (
    <>
      <h3>Board</h3>
      <div className="field">
        <label htmlFor="board-visibility">Request visibility</label>
        <select
          id="board-visibility"
          value={current.privateRequests ? 'private' : 'shared'}
          disabled={busy}
          onChange={(event) => save(event.target.value === 'private')}
        >
          <option value="shared">Shared — everyone sees every request</option>
          <option value="private">Private — requesters see only their own</option>
        </select>
        <p className="field-hint">Private suits print farms and paid work: requesters see, reorder, and withdraw only their own requests. Operators always see everything.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Board settings saved.</p>}
    </>
  )
}

function UsersPane({ me }: { me: Identity }) {
  const { data: users } = useQuery(usersQuery())
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<Identity | null>(null)
  return (
    <>
      <h3>Users</h3>
      <ul className="settings-users">
        {(users ?? []).map((user) => (
          <li key={user.id}>
            <span>{user.name}</span>
            <span className="settings-dim">{user.email}</span>
            <span className="chip settings-role">{user.role}</span>
            {user.id !== me.id && (
              <button type="button" className="btn" onClick={() => { setAdding(false); setResetting(user) }}>Set password</button>
            )}
          </li>
        ))}
      </ul>
      {resetting && <SetPasswordForm key={resetting.id} user={resetting} onDone={() => setResetting(null)} />}
      {adding && <CreateUserForm onDone={() => setAdding(false)} />}
      {!adding && !resetting && (
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add user</button>
        </div>
      )}
    </>
  )
}

function SetPasswordForm({ user, onDone }: { user: Identity; onDone: () => void }) {
  const callSetPassword = useServerFn(setUserPassword)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callSetPassword({ data: { userId: user.id, password } })
      onDone()
    } catch {
      setError('Could not set the password. Use at least 8 characters.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="field"><label htmlFor="set-password">New password for {user.name}</label><input id="set-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={256} autoComplete="new-password" required /></div>
      <p className="field-hint">Signs {user.name} out everywhere; share the new password with them directly.</p>
      {error && <p className="error">{error}</p>}
      <div className="settings-actions"><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Setting…' : 'Set password'}</button></div>
    </form>
  )
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['people'] }),
        queryClient.invalidateQueries({ queryKey: ['users'] }),
      ])
      onDone()
    } catch {
      setError('Could not create this user. Check the fields and email address.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <div className="field"><label htmlFor="user-name">Name</label><input id="user-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></div>
      <div className="field"><label htmlFor="user-email">Email</label><input id="user-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
      <div className="field"><label htmlFor="user-password">Initial password</label><input id="user-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={256} required /></div>
      <div className="field"><label htmlFor="user-role">Role</label><select id="user-role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="requester">Requester</option><option value="operator">Operator</option></select></div>
      {error && <p className="error">{error}</p>}
      <div className="settings-actions"><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></div>
    </form>
  )
}

function StoragePane() {
  const { data: current } = useQuery(storageQuery())
  if (!current) return <h3>Storage</h3>
  return <StorageForm key={current.adapter} current={current} />
}

function StorageForm({ current }: { current: StorageConfig }) {
  const callUpdate = useServerFn(updateStorageSettings)
  const queryClient = useQueryClient()
  const s3 = current.adapter === 's3' ? current : undefined
  const [adapter, setAdapter] = useState<StorageConfig['adapter']>(current.adapter)
  const [root, setRoot] = useState(current.adapter === 'local' ? current.root : '/prints')
  const [endpoint, setEndpoint] = useState(s3?.endpoint ?? '')
  const [region, setRegion] = useState(s3?.region ?? 'us-east-1')
  const [bucket, setBucket] = useState(s3?.bucket ?? '')
  const [prefix, setPrefix] = useState(s3?.prefix ?? '')
  const [accessKeyId, setAccessKeyId] = useState(s3?.accessKeyId ?? '')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [forcePathStyle, setForcePathStyle] = useState(s3?.forcePathStyle ?? true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const config: StorageConfig = adapter === 'local'
        ? { adapter: 'local', root }
        : { adapter: 's3', endpoint, region, bucket, prefix: prefix || undefined, accessKeyId, secretAccessKey, forcePathStyle }
      await callUpdate({ data: config })
      await queryClient.invalidateQueries({ queryKey: ['storage'] })
      setSecretAccessKey('')
      setSaved(true)
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : ''
      setError(message || 'Could not save storage settings.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <h3>Storage</h3>
      <p className="settings-dim">Where finished print files live. Switching is only possible while the board is empty; existing files are not migrated.</p>
      <div className="field">
        <label htmlFor="storage-adapter">Adapter</label>
        <select id="storage-adapter" value={adapter} onChange={(event) => setAdapter(event.target.value as StorageConfig['adapter'])}>
          <option value="local">Local folder</option>
          <option value="s3">S3-compatible object storage</option>
        </select>
      </div>
      {adapter === 'local' && (
        <div className="field">
          <label htmlFor="storage-root">Folder</label>
          <input id="storage-root" value={root} onChange={(event) => setRoot(event.target.value)} placeholder="/prints" required />
        </div>
      )}
      {adapter === 's3' && (
        <>
          <div className="field"><label htmlFor="storage-endpoint">Endpoint</label><input id="storage-endpoint" type="url" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://minio.local:9000" required /></div>
          <div className="field-row">
            <div className="field"><label htmlFor="storage-bucket">Bucket</label><input id="storage-bucket" value={bucket} onChange={(event) => setBucket(event.target.value)} required /></div>
            <div className="field"><label htmlFor="storage-region">Region</label><input id="storage-region" value={region} onChange={(event) => setRegion(event.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="storage-prefix">Key prefix (optional)</label><input id="storage-prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} placeholder="printhub" /></div>
          <div className="field"><label htmlFor="storage-access">Access key ID</label><input id="storage-access" value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} autoComplete="off" required /></div>
          <div className="field"><label htmlFor="storage-secret">Secret access key</label><input id="storage-secret" type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} placeholder={s3 ? 'leave blank to keep current' : ''} autoComplete="off" required={!s3} /></div>
          <label className="settings-check">
            <input type="checkbox" checked={forcePathStyle} onChange={(event) => setForcePathStyle(event.target.checked)} />
            Path-style requests (MinIO and most self-hosted endpoints)
          </label>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Storage settings saved and applied.</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Checking storage…' : 'Save storage settings'}</button>
    </form>
  )
}

function TelemetryPane() {
  const { data: current } = useQuery(telemetryQuery())
  const callUpdate = useServerFn(updateTelemetrySettings)
  const queryClient = useQueryClient()
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!current) return <h3>Telemetry</h3>

  const save = async (enabled: boolean) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await callUpdate({ data: { enabled } })
      await queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      setSaved(true)
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : ''
      setError(message || 'Could not save telemetry settings.')
    }
    setBusy(false)
  }

  return (
    <>
      <h3>Telemetry</h3>
      <p className="settings-dim">PrintHub sends anonymous usage events to its developers so we can see how the app is used. It never sends email addresses, user names, request names, or file names.</p>
      <label className="settings-check">
        <input type="checkbox" checked={current.enabled} disabled={busy} onChange={(event) => save(event.target.checked)} />
        Share anonymous usage data
      </label>
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Telemetry settings saved. The server applies them immediately; browsers on their next page load.</p>}
    </>
  )
}

function AboutPane() {
  return (
    <>
      <h3>About</h3>
      <p className="settings-dim">PrintHub v{__APP_VERSION__}</p>
    </>
  )
}
