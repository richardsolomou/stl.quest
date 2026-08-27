import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsPage({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-page" className={cn('flex min-w-0 flex-col gap-6', className)} {...props} />
}

export function SettingsHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header data-slot="settings-header" className="flex flex-col gap-2 border-b-2 border-dashed border-blueprint/25 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {children}
      </div>
      {description && <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </header>
  )
}

export function SettingsSection({
  title,
  description,
  tone = 'default',
  className,
  children,
  ...props
}: ComponentProps<'fieldset'> & { title?: string; description?: ReactNode; tone?: 'default' | 'danger' }) {
  const danger = tone === 'danger'
  return (
    <fieldset
      data-slot="settings-section"
      data-tone={tone}
      className={cn(
        'm-0 flex min-w-0 flex-col gap-4 rounded-sm border-2 px-5 pt-4 pb-5',
        danger ? 'border-destructive/40 bg-destructive/5' : 'border-border/70 bg-card/40',
        className,
      )}
      {...props}
    >
      {title && (
        <legend
          className={cn(
            'rounded-sm border-2 bg-background px-2 py-0.5 font-heading text-xs font-semibold tracking-[0.08em] uppercase',
            danger ? 'border-destructive/50 text-destructive' : 'border-blueprint/30 text-foreground',
          )}
        >
          {title}
        </legend>
      )}
      {description && <p className="-mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {children}
    </fieldset>
  )
}

export function SettingsActions({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-actions" className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
}
