export function OnboardingProgress({ step, accountLabel = 'Admin' }: { step: number; accountLabel?: 'Admin' | 'Account' }) {
  const steps = ['About', accountLabel, 'Storage', 'Printers']
  return (
    <div className="space-y-2" aria-label={`Setup step ${step} of ${steps.length}: ${steps[step - 1]}`}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          Step {step} of {steps.length}
        </span>
        <span>{steps[step - 1]}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {steps.map((label, index) => (
          <span key={label} className={index < step ? 'h-1 rounded-full bg-primary' : 'h-1 rounded-full bg-muted'} />
        ))}
      </div>
    </div>
  )
}
