import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { faviconHref } from '../../favicon'
import { useI18n } from '../i18n'

export function Brand({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 font-heading text-xl font-extrabold tracking-[0.02em] uppercase', className)}
      {...props}
    >
      <img src={faviconHref(__APP_VERSION__)} alt="" aria-hidden="true" className="size-[1.15em] shrink-0" />
      STL Quest
    </span>
  )
}

export function BarBrand() {
  return (
    <span className="inline-flex items-center gap-2 font-heading text-lg leading-none font-extrabold tracking-[0.02em] whitespace-nowrap uppercase">
      <img src={faviconHref(__APP_VERSION__)} alt="" aria-hidden="true" className="size-7 shrink-0" />
      <span className="max-sm:sr-only">STL Quest</span>
    </span>
  )
}

export function AuthBrand() {
  const { t } = useI18n()
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <Brand className="text-3xl" />
      <p className="text-sm text-muted-foreground">{t.auth.tagline}</p>
    </div>
  )
}
