import { cn } from '@/lib/utils'
import { useI18n } from '@/client/i18n'

function Spinner({ className, ...props }: React.ComponentProps<'output'>) {
  const { t } = useI18n()
  return (
    <output
      aria-label={t.shell.ui.loading}
      data-slot="spinner"
      className={cn('inline-flex size-4 items-end gap-[2px]', className)}
      {...props}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-full flex-1 origin-bottom rounded-[1px] bg-current motion-safe:animate-[layer-rise_0.9s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </output>
  )
}

export { Spinner }
