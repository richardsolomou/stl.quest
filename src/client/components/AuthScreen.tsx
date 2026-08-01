import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AuthCapabilities } from '../../core/auth'
import { AuthenticationMethods } from './AuthenticationMethods'
import { AuthIntroduction, AuthSourceOffer } from './AuthIntroduction'
import { AuthBrand } from './Brand'
import { authCapabilitiesQuery } from '../queries'

export function AuthScreen({
  setupRequired,
  hosted,
  auth,
  creatingAccount: initialCreatingAccount = false,
}: {
  setupRequired: boolean
  hosted: boolean
  auth: AuthCapabilities
  creatingAccount?: boolean
}) {
  const { data: currentAuth } = useQuery({ ...authCapabilitiesQuery(), initialData: auth })
  const [hydrated, setHydrated] = useState(false)
  const [showIntroduction, setShowIntroduction] = useState(setupRequired)
  const [creatingAccount, setCreatingAccount] = useState(initialCreatingAccount)
  useEffect(() => setHydrated(true), [])
  const signingUp = setupRequired || creatingAccount
  const initialAdmin = setupRequired && !hosted

  if (setupRequired && showIntroduction) {
    return <AuthIntroduction initialAdmin={initialAdmin} hydrated={hydrated} onContinue={() => setShowIntroduction(false)} />
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        <Card className="w-full shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle>{initialAdmin ? 'Welcome' : signingUp ? 'Create account' : 'Sign in'}</CardTitle>
            {setupRequired && (
              <CardDescription>
                {initialAdmin
                  ? 'Create the admin account to get started. The admin runs the print queue and manages access for everyone else.'
                  : 'Create your account to get a private workspace for your print queue, members, and settings.'}
              </CardDescription>
            )}
          </CardHeader>
          <AuthenticationMethods
            auth={currentAuth}
            hydrated={hydrated}
            initialAdmin={initialAdmin}
            setupRequired={setupRequired}
            signingUp={signingUp}
            creatingAccount={creatingAccount}
            setCreatingAccount={setCreatingAccount}
          />
        </Card>
        <AuthSourceOffer />
      </div>
    </main>
  )
}
