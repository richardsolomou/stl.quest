import { ExternalLink } from 'lucide-react'
import type { SocialAuthProvider } from '../../../core/auth'
import { SOCIAL_PROVIDER_SETTINGS } from '../../socialProviderSettings'
import { CopyableValue } from '../CopyableValue'
import { useI18n } from '../../i18n'

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
  const { t } = useI18n()
  const copy = t.settings.socialProviders
  const text = copy[provider]
  return (
    <section aria-label={copy.instructionsLabel(settings.name)} className="space-y-3 text-sm text-muted-foreground">
      {'consoleUrl' in settings && (
        <a
          className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-3"
          href={settings.consoleUrl}
          target="_blank"
          rel="noreferrer"
        >
          {copy.openConsole(text.consoleName)}
          <ExternalLink className="size-3.5" />
        </a>
      )}
      <ol className="list-decimal space-y-1 pl-5">
        {text.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {settings.showOrigin && <CopyableValue label={copy.originLabel} value={origin} />}
      <CopyableValue label={copy.callbackLabel} value={callbackUrl} />
    </section>
  )
}
