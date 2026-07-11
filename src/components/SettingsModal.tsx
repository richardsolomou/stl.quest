import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import type { AuthConfig, Identity, StorageConfig } from '../core/types'
import { changePassword, createUser, logout, updateAuthSettings, updateStorageSettings } from '../server/fns'
import { authQuery, storageQuery, usersQuery } from '../lib/queries'
import { useEscape } from '../lib/useEscape'

type Pane = 'account' | 'users' | 'auth' | 'storage' | 'about'

export function SettingsModal({ me, localAuth, onClose }: { me: Identity; localAuth: boolean; onClose: () => void }) {
  const [pane, setPane] = useState<Pane>('account')
  useEscape(onClose)
  const operator = me.role === 'operator'
  const panes: { id: Pane; label: string }[] = [
    { id: 'account', label: 'Account' },
    ...(operator ? [
      { id: 'users' as const, label: 'Users' },
      { id: 'auth' as const, label: 'Authentication' },
      { id: 'storage' as const, label: 'Storage' },
    ] : []),
    { id: 'about', label: 'About' },
  ]

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog dialog-settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="btn settings-close" aria-label="Close settings" onClick={onClose}>✕</button>
        </div>
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
            {pane === 'account' && <AccountPane me={me} localAuth={localAuth} />}
            {pane === 'users' && operator && <UsersPane />}
            {pane === 'auth' && operator && <AuthPane />}
            {pane === 'storage' && operator && <StoragePane />}
            {pane === 'about' && <AboutPane localAuth={localAuth} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function AccountPane({ me, localAuth }: { me: Identity; localAuth: boolean }) {
  const callLogout = useServerFn(logout)
  return (
    <>
      <h3>Account</h3>
      <p className="settings-identity">
        {me.name} <span className="settings-dim">({me.email})</span>
        <span className="chip settings-role">{me.role}</span>
      </p>
      {localAuth ? (
        <>
          <ChangePasswordForm />
          <div className="settings-actions">
            <button type="button" className="btn sign-out" onClick={async () => { await callLogout(); window.location.reload() }}>Sign out</button>
          </div>
        </>
      ) : (
        <p className="settings-dim">Your identity is managed by the authentication proxy in front of PrintHub.</p>
      )}
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

function UsersPane() {
  const { data: users } = useQuery(usersQuery())
  const [adding, setAdding] = useState(false)
  return (
    <>
      <h3>Users</h3>
      <ul className="settings-users">
        {(users ?? []).map((user) => (
          <li key={user.id}>
            <span>{user.name}</span>
            <span className="settings-dim">{user.email}</span>
            <span className="chip settings-role">{user.role}</span>
          </li>
        ))}
      </ul>
      {adding ? <CreateUserForm onDone={() => setAdding(false)} /> : (
        <div className="settings-actions">
          <button type="button" className="btn" onClick={() => setAdding(true)}>Add user</button>
        </div>
      )}
    </>
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

function AuthPane() {
  const { data: current } = useQuery(authQuery())
  if (!current) return <h3>Authentication</h3>
  return <AuthForm key={current.provider} current={current} />
}

function AuthForm({ current }: { current: AuthConfig }) {
  const callUpdate = useServerFn(updateAuthSettings)
  const queryClient = useQueryClient()
  const trusted = current.provider === 'trusted-header' ? current : undefined
  const [provider, setProvider] = useState<AuthConfig['provider']>(current.provider)
  const [emailHeader, setEmailHeader] = useState(trusted?.emailHeader ?? 'Cf-Access-Authenticated-User-Email')
  const [proxySecret, setProxySecret] = useState('')
  const [operatorEmails, setOperatorEmails] = useState(trusted?.operatorEmails.join(', ') ?? '')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await callUpdate({ data: { provider, emailHeader, proxySecret, operatorEmails } })
      await queryClient.invalidateQueries()
      setProxySecret('')
      setSaved(true)
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : ''
      setError(message || 'Could not save authentication settings.')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="settings-form">
      <h3>Authentication</h3>
      <p className="settings-dim">How people sign in. Trusted-header mode delegates identity to an authenticating proxy (Cloudflare Access, Authentik…) and can only be enabled from a session that already runs through that proxy.</p>
      <div className="field">
        <label htmlFor="auth-provider">Mode</label>
        <select id="auth-provider" value={provider} onChange={(event) => setProvider(event.target.value as AuthConfig['provider'])}>
          <option value="local">Built-in accounts</option>
          <option value="trusted-header">Trusted header (authenticating proxy)</option>
        </select>
      </div>
      {provider === 'trusted-header' && (
        <>
          <div className="field"><label htmlFor="auth-header">Email header</label><input id="auth-header" value={emailHeader} onChange={(event) => setEmailHeader(event.target.value)} required /></div>
          <div className="field"><label htmlFor="auth-secret">Proxy secret</label><input id="auth-secret" type="password" value={proxySecret} onChange={(event) => setProxySecret(event.target.value)} placeholder={trusted ? 'leave blank to keep current' : 'at least 24 characters'} autoComplete="off" required={!trusted} /><p className="field-hint">The proxy must overwrite <code>X-PrintHub-Proxy-Secret</code> with this value on every request.</p></div>
          <div className="field"><label htmlFor="auth-operators">Operator emails</label><textarea id="auth-operators" rows={2} value={operatorEmails} onChange={(event) => setOperatorEmails(event.target.value)} placeholder="you@example.com, teammate@example.com" required /></div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {saved && <p className="settings-saved">Authentication settings saved and applied.</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save authentication settings'}</button>
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

function AboutPane({ localAuth }: { localAuth: boolean }) {
  return (
    <>
      <h3>About</h3>
      <p className="settings-dim">PrintHub v{__APP_VERSION__} · {localAuth ? 'built-in accounts' : 'trusted-header identity'}</p>
    </>
  )
}
