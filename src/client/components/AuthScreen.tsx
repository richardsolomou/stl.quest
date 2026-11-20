import { useState } from 'react'
import { useLocation, useHydrated } from '@tanstack/react-router'
import { hasSocialSignInError } from '../socialSignIn'
import { useQuery } from '@tanstack/react-query'
import type { SignInCapabilities } from '../../core/auth'
import { AuthenticationMethods } from './AuthenticationMethods'
import { AuthIntroduction, AuthSourceOffer } from './AuthIntroduction'
import { AuthTicket } from './AuthTicket'
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
  const hydrated = useHydrated()
  const search = useLocation({ select: (location) => location.searchStr })
  const [showIntroduction, setShowIntroduction] = useState(setupRequired && !hasSocialSignInError(search))
  const [creatingAccount, setCreatingAccount] = useState(initialCreatingAccount)
  const signingUp = setupRequired || (creatingAccount && currentAuth.selfSignup)
  const initialAdmin = setupRequired && !hosted

  if (setupRequired && showIntroduction) {
    return <AuthIntroduction initialAdmin={initialAdmin} hydrated={hydrated} onContinue={() => setShowIntroduction(false)} />
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <AuthBrand />
        <AuthTicket
          title={initialAdmin ? t.auth.screen.welcome : signingUp ? t.auth.createAccount : t.auth.signIn}
          description={setupRequired && (initialAdmin ? t.auth.screen.adminSetup : t.auth.screen.accountSetup)}
        >
          <AuthenticationMethods
            auth={currentAuth}
            hydrated={hydrated}
            initialAdmin={initialAdmin}
            setupRequired={setupRequired}
            signingUp={signingUp}
            creatingAccount={creatingAccount}
            setCreatingAccount={setCreatingAccount}
          />
        </AuthTicket>
        <AuthSourceOffer />
      </div>
    </main>
  )
}
