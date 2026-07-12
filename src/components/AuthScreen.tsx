import { useState } from 'react'
import { authClient } from '../lib/authClient'

export function AuthScreen({ setupRequired }: { setupRequired: boolean }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { error: failed } = setupRequired
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password })
    if (failed) {
      setError(setupRequired ? 'Check the fields and use at least 8 password characters.' : 'Email or password is incorrect.')
      setBusy(false)
      return
    }
    window.location.reload()
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <h1 className="logo">Print<span className="accent">Hub</span></h1>
        <p className="auth-tagline">self-hosted print queue</p>
        <div className="auth-dots" aria-hidden="true"><span /><span /><span /></div>
      </div>
      <form className="dialog auth-card" onSubmit={submit}>
        <h2>{setupRequired ? 'Welcome' : 'Sign in'}</h2>
        {setupRequired && <p className="auth-intro">Create the operator account to get started. The operator runs the print queue and can invite requesters later.</p>}
        {setupRequired && <div className="field"><label htmlFor="auth-name">Name</label><input id="auth-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>}
        <div className="field"><label htmlFor="auth-email">Email</label><input id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></div>
        <div className="field"><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={setupRequired ? 8 : undefined} autoComplete={setupRequired ? 'new-password' : 'current-password'} /></div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Working…' : setupRequired ? 'Create operator' : 'Sign in'}</button>
      </form>
    </main>
  )
}
