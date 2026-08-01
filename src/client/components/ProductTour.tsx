import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Grip, MousePointer2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { dismissProductTour, PRODUCT_TOUR_EVENT, shouldShowProductTour, snoozeProductTour } from '../productTour'

const steps = [
  {
    title: 'Your print queue at a glance',
    description: 'Each column is a stage in your workflow. Open a print to see its files and details.',
    icon: MousePointer2,
    target: 'board',
  },
  {
    title: 'Drop files anywhere',
    description: 'Drag STL files from your computer onto this page to start a print request, or use Add a print.',
    icon: Upload,
    target: 'upload',
  },
  {
    title: 'Move and manage prints',
    description: 'Drag cards between columns to update their stage. Right-click a card for move, group, select, and delete actions.',
    icon: Grip,
    target: 'board',
  },
] as const

export function ProductTour({ identityId }: { identityId: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    setOpen(shouldShowProductTour(identityId))
    const replay = () => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener(PRODUCT_TOUR_EVENT, replay)
    return () => window.removeEventListener(PRODUCT_TOUR_EVENT, replay)
  }, [identityId])

  useEffect(() => {
    if (!open) return
    const target = document.querySelector(`[data-tour="${steps[step].target}"]`)
    target?.setAttribute('data-tour-active', 'true')
    return () => target?.removeAttribute('data-tour-active')
  }, [open, step])

  if (!open) return null
  const current = steps[step]
  const Icon = current.icon
  const finish = () => {
    dismissProductTour(identityId)
    setOpen(false)
  }

  return (
    <section
      aria-label="Product tour"
      aria-live="polite"
      className="fixed right-4 bottom-20 z-30 w-[min(24rem,calc(100vw-2rem))] rounded-xl border-2 border-blueprint bg-background p-4 shadow-xl"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-heading text-xs tracking-[0.08em] text-muted-foreground uppercase">
          Quick tour · {step + 1} of {steps.length}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => {
            snoozeProductTour(identityId)
            setOpen(false)
          }}
        >
          Remind me tomorrow
        </Button>
      </div>
      <div className="flex gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="font-heading text-lg">{current.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{current.description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
        {steps.map((item, index) => (
          <span key={item.title} className={cn('h-1.5 flex-1 rounded-full bg-muted', index <= step && 'bg-primary')} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={finish}>
          Skip tour
        </Button>
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setStep(step - 1)}>
              <ChevronLeft />
              Back
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => (step === steps.length - 1 ? finish() : setStep(step + 1))}>
            {step === steps.length - 1 ? 'Done' : 'Next'}
            {step < steps.length - 1 && <ChevronRight />}
          </Button>
        </div>
      </div>
    </section>
  )
}
