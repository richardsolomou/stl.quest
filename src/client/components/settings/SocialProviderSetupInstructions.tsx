import { ExternalLink } from 'lucide-react'
import type { SocialAuthProvider } from '../../../core/auth'
import { SOCIAL_PROVIDER_SETTINGS } from '../../socialProviderSettings'
import { CopyableValue } from '../CopyableValue'

export function SocialProviderSetupInstructions({
  provider,
  origin,
  callbackUrl,
}: {
  provider: SocialAuthProvider
  origin: string
  callbackUrl: string
}) {
  const settings = SOCIAL_PROVIDER_SETTINGS[provider]
  return (
    <section aria-label={`${settings.name} setup instructions`} className="space-y-3 text-sm text-muted-foreground">
      <a
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
        href={settings.consoleUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open {settings.consoleName}
        <ExternalLink className="size-3.5" />
      </a>
      <ol className="list-decimal space-y-1 pl-5">
        {settings.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {settings.showOrigin && <CopyableValue label="STL Quest URL" value={origin} />}
      <CopyableValue label="Callback URL" value={callbackUrl} />
    </section>
  )
}
