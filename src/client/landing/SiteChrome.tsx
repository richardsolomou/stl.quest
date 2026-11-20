import { usePostHog } from '@posthog/react'
import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, Menu, X } from 'lucide-react'
import { Brand } from '@/client/components/Brand'
import { Button, ButtonLink } from '@/components/ui/button'
import { RELEASES_URL, REPOSITORY_URL } from '@/client/sourceCode'
import { cn } from '@/lib/utils'
import { SIGN_IN_PATH, SIGN_UP_PATH } from './site'

/** The landing pages' one measure: every band shares this column, so the page keeps one left edge. */
export const column = 'mx-auto w-[min(72rem,calc(100%-2rem))]'

export function useTrackLink() {
  const posthog = usePostHog()
  return (link: string, location: string) => posthog?.capture('website_link_clicked', { link, location })
}

const barLink =
  'inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'

export function ExternalLinkIcon() {
  return <ExternalLink data-icon="inline-end" className="size-3.5" aria-hidden="true" />
}

/** The application's bar, seen from outside: steel ground, a hairline beneath, the brand, and where to go. */
type BarSection = readonly [href: string, label: string, link: string]

const noSections: readonly BarSection[] = []

export function SiteBar({ sections = noSections }: { sections?: readonly BarSection[] }) {
  const trackLink = useTrackLink()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [open])

  function follow(link: string) {
    trackLink(link, 'header')
    setOpen(false)
  }

  return (
    <>
      <a
        className="fixed top-2 left-2 z-50 -translate-y-16 rounded-md bg-popover px-3 py-2 text-sm font-semibold shadow-xl focus:translate-y-0"
        href="#main"
      >
        Skip to content
      </a>
      <header className="relative border-b border-border">
        <div className={cn(column, 'flex h-[3.25rem] items-center gap-4')}>
          <a className="shrink-0 rounded-md" href="/home" aria-label="STL Quest home" onClick={() => trackLink('home', 'header')}>
            <Brand className="text-lg" />
          </a>
          <Button
            className="ml-auto lg:hidden"
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-controls="site-navigation"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </Button>
          {open && <div aria-hidden="true" className="fixed inset-0 z-10 bg-black/10 lg:hidden" onClick={() => setOpen(false)} />}
          <nav
            id="site-navigation"
            aria-label="Main navigation"
            className={cn(
              open ? 'flex' : 'hidden',
              'absolute inset-x-4 top-full z-20 mt-2 flex-col items-stretch gap-1 rounded-lg bg-popover p-2 shadow-2xl ring-1 ring-foreground/10',
              'lg:static lg:inset-auto lg:mt-0 lg:ml-auto lg:flex lg:flex-row lg:items-center lg:gap-1 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0',
            )}
          >
            {sections.map(([href, label, link]) => (
              <a key={href} className={barLink} href={href} onClick={() => follow(link)}>
                {label}
              </a>
            ))}
            <a className={barLink} href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" onClick={() => follow('github')}>
              GitHub <ExternalLinkIcon />
            </a>
            <a className={barLink} href={SIGN_IN_PATH} onClick={() => follow('sign_in')}>
              Sign in
            </a>
            <ButtonLink className="lg:ml-2" variant="outline" href={SIGN_UP_PATH} onClick={() => follow('create_workspace')}>
              Create a free workspace
            </ButtonLink>
          </nav>
        </div>
      </header>
    </>
  )
}

function FooterLink({ href, link, children }: { href: string; link: string; children: ReactNode }) {
  const trackLink = useTrackLink()
  const external = href.startsWith('http')
  return (
    <a
      className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      href={href}
      onClick={() => trackLink(link, 'footer')}
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
    >
      {children}
      {external && <ExternalLink className="size-3" aria-hidden="true" />}
    </a>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div
        className={cn(
          column,
          'flex flex-col gap-4 py-6 font-mono text-xs text-muted-foreground uppercase sm:flex-row sm:items-center sm:justify-between',
        )}
      >
        <p className="flex flex-wrap gap-x-5 gap-y-2">
          <span>© {new Date().getFullYear()} STL Quest</span>
          <span>Free and open source under AGPL-3.0</span>
        </p>
        <p className="flex flex-wrap gap-x-5 gap-y-2">
          <FooterLink href="/terms" link="terms">
            Terms
          </FooterLink>
          <FooterLink href="/privacy" link="privacy">
            Privacy
          </FooterLink>
          <FooterLink href={RELEASES_URL} link="releases">
            Releases
          </FooterLink>
          <FooterLink href={REPOSITORY_URL} link="github">
            GitHub
          </FooterLink>
        </p>
      </div>
    </footer>
  )
}
