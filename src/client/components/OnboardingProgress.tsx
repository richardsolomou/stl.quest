import { cn } from '@/lib/utils'
import { useI18n } from '../i18n'

const STEPS = ['storage', 'printers'] as const

export function OnboardingProgress({ step }: { step: number }) {
  const { t } = useI18n()
  const name = t.shell.setup.steps[STEPS[step - 1]]
  return (
    <div className="space-y-2" aria-label={t.shell.setup.progressLabel(step, STEPS.length, name)}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t.shell.setup.stepOf(step, STEPS.length)}</span>
        <span>{name}</span>
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {STEPS.map((id, index) => (
          <span key={id} className={cn('h-1 flex-1 rounded-full', index < step ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>
    </div>
  )
}
