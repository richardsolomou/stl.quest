const STEPS = ['About', 'Admin', 'Storage', 'Printers']

export function OnboardingProgress({ step }: { step: number }) {
  return (
    <div className="space-y-2" aria-label={`Setup step ${step} of ${STEPS.length}: ${STEPS[step - 1]}`}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Step {step} of {STEPS.length}
        </span>
        <span>{STEPS[step - 1]}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {STEPS.map((label, index) => (
          <span key={label} className={index < step ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-muted'} />
        ))}
      </div>
    </div>
  )
}
