import { Boxes, Printer, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '../i18n'
import { SOURCE_CODE_URL } from '../sourceCode'
import { AuthBrand } from './Brand'

export function AuthIntroduction({
  initialAdmin,
  hydrated,
  onContinue,
}: {
  initialAdmin: boolean
  hydrated: boolean
  onContinue: () => void
}) {
  const { t } = useI18n()
  const copy = t.auth.introduction
  return (
    <main className="grid min-h-dvh place-items-center p-6 [background-image:var(--grid)] [background-size:24px_24px]">
      <div className="flex w-full max-w-[720px] flex-col gap-5">
        <AuthBrand />
        <Card className="shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <IntroductionItem icon={ShieldCheck} title={copy.privateTitle}>
                {copy.privateBody}
              </IntroductionItem>
              <IntroductionItem icon={Boxes} title={copy.trackingTitle}>
                {copy.trackingBody}
              </IntroductionItem>
              <IntroductionItem icon={Printer} title={copy.printersTitle}>
                {copy.printersBody}
              </IntroductionItem>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3.5 text-sm text-muted-foreground">
              <p>{initialAdmin ? copy.nextSuperAdmin : copy.nextAccount}</p>
              <p className="mt-1">{copy.telemetry}</p>
            </div>
            <Button type="button" className="self-end" disabled={!hydrated} onClick={onContinue}>
              {copy.setUp}
            </Button>
          </CardContent>
        </Card>
        <AuthSourceOffer />
      </div>
    </main>
  )
}

export function AuthSourceOffer() {
  const { t } = useI18n()
  const offer = t.auth.sourceOffer
  return (
    <p className="text-center text-xs text-muted-foreground">
      {offer.before}{' '}
      <a className="underline underline-offset-4 hover:text-foreground" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
        {offer.link}
      </a>
      {offer.after}
    </p>
  )
}

function IntroductionItem({ icon: Icon, title, children }: { icon: typeof Printer; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border-2 border-dashed border-blueprint/25 bg-card p-3.5">
      <Icon className="mb-2 size-5 text-primary" />
      <h3 className="font-heading font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
