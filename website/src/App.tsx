import { usePostHog } from '@posthog/react'
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleAlert,
  Cloud,
  Copy,
  ExternalLink,
  House,
  Inbox,
  ListOrdered,
  Maximize2,
  Menu,
  Minimize2,
  PackageCheck,
  Pause,
  Play,
  Printer,
  X,
} from 'lucide-react'
import { Brand } from '@/client/components/Brand'
import { NasMark } from './components/NasMarks'
import { Button, ButtonLink } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/Card'
import { LegalPage } from './LegalPage'
import { NAS_CATALOGUES, SELF_HOSTING_GUIDE_URL, SIGN_UP_URL, STORAGE_PROVIDERS } from './site'
import { REPOSITORY_URL } from '@/client/sourceCode'

// One mark treatment across the run-it cards: the amber belongs to the action inside them, not the icon.
const cardMarkClass = 'grid size-9 place-items-center rounded-full bg-muted text-muted-foreground'

const sectionClass =
  'mx-auto grid w-[min(1040px,calc(100%-48px))] gap-10 border-t py-11 min-[821px]:grid-cols-[210px_1fr] min-[821px]:gap-12 min-[821px]:py-14'

// Coloured in board order, so the row teaches the sequence a request actually moves through:
// queue, up next, printing, ready. The application uses these same four for those stages.
const capabilities = [
  [Inbox, 'Collect requests', 'Models, quantities, notes, resin, and filament.', 'bg-muted-foreground/10 text-muted-foreground'],
  [ListOrdered, 'Plan the queue', 'Round robin, oldest first, requester priority, or manual.', 'bg-blueprint/10 text-blueprint'],
  [Printer, 'Match printers', 'Filter by build volume and resin or filament compatibility.', 'bg-primary/10 text-primary'],
  [PackageCheck, 'Follow every copy', 'Printing, finishing, and collection status per copy.', 'bg-success/10 text-success'],
] as const

const dockerCommand = [
  'docker run -d \\',
  '  -p 30455:3000 \\',
  '  -v /path/to/data:/data \\',
  '  -v /path/to/prints:/prints \\',
  '  ghcr.io/richardsolomou/stl.quest:latest',
].join('\n')

function ExternalLinkIcon() {
  return <ExternalLink data-icon="inline-end" aria-hidden="true" />
}

const copyLabels = {
  idle: 'Copy the Docker command',
  copied: 'Docker command copied',
  failed: 'Could not copy the Docker command',
}

/**
 * Fallback for when navigator.clipboard is missing (insecure origin) or refuses the write. Copies
 * from a hidden textarea and puts any existing selection back, so nothing appears selected.
 */
function copyViaHiddenTextarea(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(textarea)

  const selection = getSelection()
  const selected = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null

  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()

  selection?.removeAllRanges()
  if (selected) selection?.addRange(selected)

  return copied
}

function CommandBlock({ command }: { command: string }) {
  const posthog = usePostHog()
  const [feedback, setFeedback] = useState<keyof typeof copyLabels>('idle')

  async function copy() {
    let copied = false
    let method = 'clipboard'
    try {
      await navigator.clipboard.writeText(command)
      copied = true
    } catch {
      method = 'fallback'
      copied = copyViaHiddenTextarea(command)
    }
    posthog?.capture('docker_command_copy_completed', { success: copied, method })
    setFeedback(copied ? 'copied' : 'failed')
    setTimeout(() => setFeedback('idle'), 2000)
  }

  return (
    <div className="relative mb-6 min-w-0">
      <pre className="w-full overflow-x-auto rounded-md bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
        <code>{command}</code>
      </pre>
      <Button
        className="absolute top-1.5 right-1.5 [&_svg]:size-3.5"
        variant="ghost"
        size="icon"
        onClick={copy}
        aria-label={copyLabels[feedback]}
      >
        {feedback === 'copied' && <Check className="text-success" />}
        {feedback === 'failed' && <CircleAlert className="text-destructive" />}
        {feedback === 'idle' && <Copy />}
      </Button>
    </div>
  )
}

function ProductTour() {
  const posthog = usePostHog()
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const milestones = useRef(new Set<number>())
  // Driven by the video's own events, since playback can still be refused (iOS Low Power Mode).
  const [playing, setPlaying] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Started here rather than with the autoplay attribute so the prerendered markup never moves
  // before we can read the motion preference, and so a refused play just leaves the poster up.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    void videoRef.current?.play().catch(() => {})
  }, [])

  useEffect(() => {
    function trackFullscreen() {
      setExpanded(document.fullscreenElement === frameRef.current)
    }
    document.addEventListener('fullscreenchange', trackFullscreen)
    return () => document.removeEventListener('fullscreenchange', trackFullscreen)
  }, [])

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    const action = video.paused ? 'play' : 'pause'
    posthog?.capture('product_tour_control_clicked', { action, current_time_seconds: Math.round(video.currentTime) })
    // A refused play (e.g. Firefox's per-site block) rejects the promise; swallow it like the autoplay effect above.
    if (action === 'play') void video.play().catch(() => {})
    else video.pause()
  }

  async function toggleExpanded() {
    const isFullscreen = document.fullscreenElement === frameRef.current
    posthog?.capture('product_tour_control_clicked', { action: isFullscreen ? 'collapse' : 'expand' })
    if (isFullscreen) {
      await document.exitFullscreen()
      return
    }
    if (frameRef.current?.requestFullscreen) {
      await frameRef.current.requestFullscreen()
      if (window.matchMedia('(max-width: 620px)').matches) {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
        void orientation.lock?.('landscape').catch(() => {})
      }
      return
    }
    const video = videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
    video?.webkitEnterFullscreen?.()
  }

  function trackProgress() {
    const video = videoRef.current
    if (!video?.duration) return
    const milestone = Math.floor((video.currentTime / video.duration) * 4) * 25
    if (milestone < 25 || milestone > 75 || milestones.current.has(milestone)) return
    milestones.current.add(milestone)
    posthog?.capture('product_tour_progress_reached', { percent: milestone })
  }

  return (
    <figure className="mx-auto mb-12 w-full min-[621px]:mb-16 min-[621px]:w-[min(1040px,calc(100%-48px))]">
      <div
        ref={frameRef}
        className="product-tour-frame overflow-hidden border-y bg-background shadow-2xl min-[621px]:rounded-lg min-[621px]:border-x"
      >
        <div className="flex h-9 items-center gap-1.5 border-b bg-card px-3">
          <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
          <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
          <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
          <Button
            className="ml-auto size-7 [&_svg]:size-3.5"
            variant="ghost"
            size="icon"
            onClick={toggleExpanded}
            aria-label={expanded ? 'Exit the expanded product tour' : 'Expand the product tour'}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            className="-mr-1.5 size-7 [&_svg]:size-3.5"
            variant="ghost"
            size="icon"
            onClick={togglePlayback}
            aria-label={playing ? 'Pause the product tour' : 'Play the product tour'}
          >
            {playing ? <Pause /> : <Play />}
          </Button>
        </div>
        <video
          ref={videoRef}
          className="aspect-4/5 w-full object-cover object-left min-[621px]:aspect-video min-[621px]:object-center"
          muted
          loop
          playsInline
          poster="/product-tour.webp"
          aria-label="The STL Quest request board, with prints grouped into queue, printing, finishing, and ready columns"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={trackProgress}
        >
          <source src="/product-tour.webm" type="video/webm" />
          <source src="/product-tour.mp4" type="video/mp4" />
        </video>
      </div>
      <figcaption className="mt-2 px-4 font-mono text-xs text-muted-foreground min-[621px]:px-0">
        Every request moves left to right: queue, up next, printing, finishing, ready.
      </figcaption>
    </figure>
  )
}

function HomePage() {
  const posthog = usePostHog()
  const [navigationOpen, setNavigationOpen] = useState(false)

  function trackLink(link: string, location: string) {
    posthog?.capture('website_link_clicked', { link, location })
  }

  function followHeaderLink(link: string) {
    trackLink(link, 'header')
    setNavigationOpen(false)
  }

  useEffect(() => {
    if (!navigationOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavigationOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [navigationOpen])

  return (
    <>
      <a className="fixed top-2 left-2 z-50 -translate-y-16 bg-card px-3 py-2 focus:translate-y-0" href="#main">
        Skip to content
      </a>

      <header className="relative mx-auto flex h-16 w-[min(1040px,calc(100%-48px))] items-center justify-between border-b-2 border-dashed border-blueprint/25">
        <a href="#top" aria-label="STL Quest home" onClick={() => trackLink('home', 'header')}>
          <Brand />
        </a>
        <Button
          className="min-[821px]:hidden"
          variant="ghost"
          size="icon"
          aria-expanded={navigationOpen}
          aria-controls="site-navigation"
          aria-label="Toggle navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          {navigationOpen ? <X /> : <Menu />}
        </Button>
        {navigationOpen && (
          <div
            aria-hidden="true"
            className="fixed inset-0 z-10 bg-background/70 min-[821px]:hidden"
            onClick={() => setNavigationOpen(false)}
          />
        )}
        <nav
          id="site-navigation"
          aria-label="Main navigation"
          className={`${navigationOpen ? 'flex' : 'hidden'} absolute top-full right-0 left-0 z-20 mt-2 flex-col items-stretch gap-1 rounded-lg border bg-card p-3 shadow-xl min-[821px]:static min-[821px]:mt-0 min-[821px]:flex min-[821px]:flex-row min-[821px]:items-center min-[821px]:gap-5 min-[821px]:border-0 min-[821px]:bg-transparent min-[821px]:p-0 min-[821px]:shadow-none`}
        >
          <ButtonLink className="justify-start" variant="ghost" href="#what-it-does" onClick={() => followHeaderLink('what_it_does')}>
            What it does
          </ButtonLink>
          <ButtonLink className="justify-start" variant="ghost" href="#ways-to-run" onClick={() => followHeaderLink('ways_to_run')}>
            Ways to run it
          </ButtonLink>
          <ButtonLink
            className="justify-start"
            variant="ghost"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => followHeaderLink('github')}
          >
            GitHub <ExternalLinkIcon />
          </ButtonLink>
          <ButtonLink variant="outline" href={SIGN_UP_URL} onClick={() => followHeaderLink('create_workspace')}>
            Create a free workspace
          </ButtonLink>
        </nav>
      </header>

      <main id="main">
        <section id="top" className="mx-auto w-[min(1040px,calc(100%-48px))] py-12 min-[621px]:pt-17 min-[621px]:pb-10">
          <h1 className="max-w-3xl font-heading text-5xl leading-[1.04] font-medium tracking-tight min-[621px]:text-[70px]">
            A home for your 3D-print requests.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-normal text-muted-foreground min-[621px]:text-xl">
            Free and open source, for anyone who prints for other people. Keep every request, printer, and copy in one place — without
            handing over your model files.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3 min-[621px]:flex-row min-[621px]:items-center">
            <ButtonLink size="xl" href="#ways-to-run" onClick={() => trackLink('self_host', 'hero')}>
              Run it on your own server
            </ButtonLink>
            <ButtonLink size="xl" variant="outline" href={SIGN_UP_URL} onClick={() => trackLink('create_workspace', 'hero')}>
              Or use the hosted version
            </ButtonLink>
          </div>
        </section>

        <ProductTour />

        <section id="what-it-does" className={sectionClass}>
          <h2 className="font-heading text-3xl font-medium">What it does</h2>
          <div className="grid gap-x-11 min-[621px]:grid-cols-2">
            {capabilities.map(([Icon, title, description, colour]) => (
              <article className="border-t py-4" key={title}>
                <h3 className="flex items-center gap-2.5 font-heading text-lg font-medium tracking-wide">
                  <span className={`grid size-7 place-items-center rounded-full ${colour}`}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  {title}
                </h3>
                <p className="mt-2 text-base leading-normal text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="your-files" className={sectionClass}>
          <h2 className="font-heading text-3xl font-medium">Your files stay yours</h2>
          <div>
            <p className="max-w-xl text-lg leading-normal text-muted-foreground">
              STL Quest keeps the queue — who asked for what, which printer it is on, and how far along it is. Use included hosted storage,
              or keep model files in storage you connect and control.
            </p>
            <ul className="mt-6 flex flex-wrap gap-1.5">
              {STORAGE_PROVIDERS.map((provider) => (
                <li className="rounded-sm border bg-card px-2 py-1 font-mono text-xs text-muted-foreground" key={provider}>
                  {provider}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="ways-to-run" className={sectionClass}>
          <h2 className="font-heading text-3xl font-medium">Ways to run it</h2>
          {/* Two-up only once the container hits its 1040px cap, below which the Docker command would not fit a half-width card. */}
          <div className="flex flex-col gap-4 min-[1088px]:grid min-[1088px]:grid-cols-[1.3fr_1fr] min-[1088px]:items-start">
            <div className="contents min-[1088px]:flex min-[1088px]:flex-col min-[1088px]:gap-4">
              <Card className="order-1 min-[1088px]:order-none">
                <CardHeader>
                  <span className={cardMarkClass}>
                    <House className="size-4" aria-hidden="true" />
                  </span>
                  <CardTitle>Run it yourself</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mt-4 mb-4 text-base leading-normal text-muted-foreground">
                    One Docker container. Keep everything on your own hardware.
                  </p>
                  <CommandBlock command={dockerCommand} />
                  <ButtonLink
                    className="self-start"
                    size="xl"
                    variant="outline"
                    href={SELF_HOSTING_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackLink('self_hosting_guide', 'self_hosted_card')}
                  >
                    Self-hosting guide <ExternalLinkIcon />
                  </ButtonLink>
                </CardContent>
              </Card>

              {NAS_CATALOGUES.slice(1).map(([platform, name, href]) => (
                <Card className="order-4 min-[1088px]:order-none" key={name}>
                  <CardHeader>
                    <span className={cardMarkClass}>
                      <NasMark className="size-4" platform={platform} />
                    </span>
                    <CardTitle>Install on {name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mt-4 mb-6 text-base leading-normal text-muted-foreground">
                      Install STL Quest straight from the {name} app catalogue.
                    </p>
                    <ButtonLink
                      className="self-start"
                      size="xl"
                      variant="outline"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackLink(`${platform}_catalogue`, `${platform}_card`)}
                    >
                      Open the {name} catalogue <ExternalLinkIcon />
                    </ButtonLink>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="contents min-[1088px]:flex min-[1088px]:flex-col min-[1088px]:gap-4">
              <Card className="order-2 min-[1088px]:order-none">
                <CardHeader>
                  <span className={cardMarkClass}>
                    <Cloud className="size-4" aria-hidden="true" />
                  </span>
                  <CardTitle>Use the hosted version</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mt-4 mb-6 text-base leading-normal text-muted-foreground">
                    Create a workspace in seconds. Connect your storage and start taking requests.
                  </p>
                  <ButtonLink
                    className="mt-auto self-start"
                    size="xl"
                    href={SIGN_UP_URL}
                    onClick={() => trackLink('create_workspace', 'hosted_card')}
                  >
                    Create a free workspace
                  </ButtonLink>
                </CardContent>
              </Card>

              {NAS_CATALOGUES.slice(0, 1).map(([platform, name, href]) => (
                <Card className="order-3 min-[1088px]:order-none" key={name}>
                  <CardHeader>
                    <span className={cardMarkClass}>
                      <NasMark className="size-4" platform={platform} />
                    </span>
                    <CardTitle>Install on {name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mt-4 mb-6 text-base leading-normal text-muted-foreground">
                      Install STL Quest straight from the {name} app catalogue.
                    </p>
                    <ButtonLink
                      className="self-start"
                      size="xl"
                      variant="outline"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackLink(`${platform}_catalogue`, `${platform}_card`)}
                    >
                      Open the {name} catalogue <ExternalLinkIcon />
                    </ButtonLink>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-[min(1040px,calc(100%-48px))] flex-col items-start gap-5 border-t py-6 font-mono text-xs text-muted-foreground min-[621px]:flex-row min-[621px]:items-center min-[621px]:justify-between">
        <div className="flex flex-col gap-5 min-[621px]:flex-row min-[621px]:gap-6">
          <span>© {new Date().getFullYear()} STL Quest</span>
          <span>Free and open source under AGPL-3.0</span>
        </div>
        <div className="flex items-center gap-5">
          <a className="hover:text-foreground" href="/terms/" onClick={() => trackLink('terms', 'footer')}>
            Terms
          </a>
          <a className="hover:text-foreground" href="/privacy/" onClick={() => trackLink('privacy', 'footer')}>
            Privacy
          </a>
          <a
            className="inline-flex items-center gap-1 hover:text-foreground"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackLink('github', 'footer')}
          >
            GitHub <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </div>
      </footer>
    </>
  )
}

export function App({ pathname = typeof window === 'undefined' ? '/' : window.location.pathname }: { pathname?: string }) {
  if (pathname === '/terms' || pathname === '/terms/') return <LegalPage policy="terms" />
  if (pathname === '/privacy' || pathname === '/privacy/') return <LegalPage policy="privacy" />
  return <HomePage />
}
