import { cn } from '@/lib/utils'

const STEPS = ['Storage', 'Printers']

export function OnboardingProgress({ step }: { step: number }) {
  const steps = STEPS
  return (
    <div className="space-y-2" aria-label={`Setup step ${step} of ${steps.length}: ${steps[step - 1]}`}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Step {step} of {steps.length}
        </span>
        <span>{steps[step - 1]}</span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((label, index) => (
          <span key={label} className={cn('h-1 flex-1 rounded-full', index < step ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>
    </div>
  )
}
