import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SignInCapabilities } from '../../core/auth'
import { AuthenticationMethods } from './AuthenticationMethods'
import { AuthIntroduction, AuthSourceOffer } from './AuthIntroduction'
import { AuthBrand } from './Brand'
import { useI18n } from '../i18n'
import { authCapabilitiesQuery } from '../queries'

export function AuthScreen({
  setupRequired,
  hosted,
  auth,
  creatingAccount: initialCreatingAccount = false,
}: {
  setupRequired: boolean
  hosted: boolean
  auth: SignInCapabilities
  creatingAccount?: boolean
}) {
  const { t } = useI18n()
  const { data: currentAuth } = useQuery({ ...authCapabilitiesQuery(), initialData: auth })
  const [hydrated, setHydrated] = useState(false)
  const [showIntroduction, setShowIntroduction] = useState(setupRequired)
  const [creatingAccount, setCreatingAccount] = useState(initialCreatingAccount)
  useEffect(() => setHydrated(true), [])
  const signingUp = setupRequired || (creatingAccount && currentAuth.selfSignup)
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
            <CardTitle>{initialAdmin ? t.auth.screen.welcome : signingUp ? t.auth.createAccount : t.auth.signIn}</CardTitle>
            {setupRequired && <CardDescription>{initialAdmin ? t.auth.screen.adminSetup : t.auth.screen.accountSetup}</CardDescription>}
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
