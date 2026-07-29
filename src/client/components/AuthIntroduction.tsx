import { Boxes, Printer, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  return (
    <main className="grid min-h-dvh place-items-center p-6 [background-image:var(--grid)] [background-size:24px_24px]">
      <div className="flex w-full max-w-[720px] flex-col gap-5">
        <AuthBrand />
        <Card className="shadow-xl shadow-black/10">
          <CardHeader>
            <CardTitle>A private 3D-print request and production queue for resin and filament printers.</CardTitle>
            <CardDescription>Accept STL requests and take each print from upload to collection.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <IntroductionItem icon={ShieldCheck} title="Private requests">
                Models and production history stay on storage you control.
              </IntroductionItem>
              <IntroductionItem icon={Boxes} title="Production tracking">
                Move each copy through Queue, Up next, Printing, Finishing, and Ready.
              </IntroductionItem>
              <IntroductionItem icon={Printer} title="Printer assignment">
                Configure resin and filament printers, then assign queued work to the right machine.
              </IntroductionItem>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3.5 text-sm text-muted-foreground">
              <p>
                Next: {initialAdmin ? 'create the super admin' : 'create your account'}, choose private storage, and add your resin or
                filament printers.
              </p>
              <p className="mt-1">Anonymous usage telemetry is enabled by default and can be disabled in Settings.</p>
            </div>
            <Button type="button" className="self-end" disabled={!hydrated} onClick={onContinue}>
              Set up STL Quest
            </Button>
          </CardContent>
        </Card>
        <AuthSourceOffer />
      </div>
    </main>
  )
}

export function AuthSourceOffer() {
  return (
    <p className="text-center text-xs text-muted-foreground">
      Open source under AGPLv3.{' '}
      <a className="underline underline-offset-4 hover:text-foreground" href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
        Get source code
      </a>
      .
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
