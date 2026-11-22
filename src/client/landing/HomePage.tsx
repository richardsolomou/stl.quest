import { usePostHog } from '@posthog/react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Check, CircleAlert, Copy } from 'lucide-react'
import { writeClipboard } from '@/client/components/useCopied'
import { ButtonLink, Button } from '@/components/ui/button'
import { LATEST_DOCUMENTATION_URL } from '@/client/sourceCode'
import { MODEL_FORMATS } from '@/core/assetKeys'
import { storagePlans } from '@/core/plans'
import { workflow, type StatusId } from '@/core/workflow'
import { cn } from '@/lib/utils'
import { CopyDemo } from './CopyDemo'
import { NasMark } from './NasMarks'
import { Shot } from './Shot'
import { ExternalLinkIcon, SiteBar, SiteFooter, column, useTrackLink } from './SiteChrome'
import { HungTicket, Perforation } from './Ticket'
import { NAS_CATALOGUES, OUTSIDE_THE_PRODUCT, SELF_HOSTING_GUIDE_URL, SIGN_UP_PATH, STORAGE_PROVIDERS } from './site'

const dockerCommand = [
  'docker run -d \\',
  '  -p 30455:3000 \\',
  '  -v /path/to/data:/data \\',
  '  -v /path/to/prints:/prints \\',
  '  ghcr.io/richardsolomou/stl.quest:latest',
].join('\n')

const sections = [
  ['#board', 'How it works', 'how_it_works'],
  ['#costs', 'Costs', 'costs'],
  ['#run', 'Run it', 'run_it'],
] as const

/** What happens in each stage, keyed by the workflow's own stage IDs so the legend follows the board's order and names. */
const stageNotes: Record<StatusId, string> = {
  todo: 'Requests wait in a fair order: round robin between requesters, oldest first, requester priority, or yours.',
  up_next: 'Tickets hang in firing order, each naming the printer it goes to.',
  in_progress: 'Grouped by printer. An idle printer is flagged with the next job that fits it.',
  post_processing: 'Washing, curing, and support removal: whatever happens after the plate.',
  done: 'Grouped by who is collecting, so a pickup is one glance.',
}

const copyLabels = {
  idle: 'Copy the Docker command',
  copied: 'Docker command copied',
  failed: 'Could not copy the Docker command',
}

/** The Docker command on an ink plate, the one thing on the page a machine reads. */
function CommandBlock() {
  const posthog = usePostHog()
  const [feedback, setFeedback] = useState<keyof typeof copyLabels>('idle')

  async function copy() {
    const { copied, method } = await writeClipboard(dockerCommand)
    posthog?.capture('docker_command_copy_completed', { success: copied, method })
    setFeedback(copied ? 'copied' : 'failed')
    setTimeout(() => setFeedback('idle'), 2000)
  }

  return (
    <div className="on-shell relative min-w-0 rounded-md bg-shell">
      <pre className="overflow-x-auto p-3 font-mono text-[0.75rem] leading-relaxed">
        <code>{dockerCommand}</code>
      </pre>
      <Button className="absolute top-1.5 right-1.5" variant="ghost" size="icon" onClick={copy} aria-label={copyLabels[feedback]}>
        {feedback === 'copied' && <Check className="text-success" />}
        {feedback === 'failed' && <CircleAlert className="text-destructive" />}
        {feedback === 'idle' && <Copy />}
      </Button>
    </div>
  )
}

/** One line of the spec sheet: its name and purpose in the margin, the evidence beside it. */
function SpecLine({
  id,
  title,
  purpose,
  aside,
  children,
}: {
  id: string
  title: string
  purpose: ReactNode
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-t border-border py-14 sm:py-20">
      <div className={cn(column, 'grid gap-x-12 gap-y-8 lg:grid-cols-[15rem_1fr]')}>
        <header>
          <h2 id={`${id}-title`} className="font-heading text-[2rem] leading-none font-bold text-balance uppercase">
            {title}
          </h2>
          <div className="mt-4 space-y-3 text-[0.95rem] leading-relaxed text-muted-foreground">{purpose}</div>
          {aside}
        </header>
        {children && <div className="min-w-0">{children}</div>}
      </div>
    </section>
  )
}

function Point({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-t border-border pt-3">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-[0.95rem] leading-relaxed text-muted-foreground">{children}</p>
    </li>
  )
}

const gigabytes = new Intl.NumberFormat('en', { style: 'unit', unit: 'gigabyte' })

function DemoCaption({ children }: { children: ReactNode }) {
  return <figcaption className="mt-2 font-mono text-[11px] text-muted-foreground uppercase">{children}</figcaption>
}

/** A dashed tag, the calculator's "typical" mark, saying a feature waits until it is turned on. */
function OptionalTag() {
  return (
    <span className="mt-4 inline-flex rounded-[3px] border border-dashed border-foreground/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground uppercase">
      Off until you turn it on
    </span>
  )
}

const catalogues = [
  ['Printers', 'Resin and filament machines with their print type, build volume, and a photo.'],
  ['Filaments', 'Every product and colour in SpoolmanDB, picked as a swatch.'],
  ['Resins', 'Manufacturer resins with their type and density.'],
  ['Equipment', 'Wash, cure, drying, and other kit, with its power draw.'],
  ['Wear parts', 'Tanks, films, screens, nozzles, plates, filters, belts, and cutters for each printer model, with sourced lifespans.'],
  ['Supplies', 'Wash fluids, gloves, glue, desiccant, and lubricant, with the ones your equipment’s maker names first.'],
  ['Electricity', 'Household prices by country, so running costs start from a real figure.'],
] as const

export function HomePage() {
  const trackLink = useTrackLink()
  const first = workflow.statuses[0].label
  const last = workflow.statuses.at(-1)!.label
  const [truenas, unraid] = NAS_CATALOGUES

  return (
    <>
      <SiteBar sections={sections} />

      <main id="main">
        <section aria-labelledby="top-title" className="pt-7 pb-12 sm:pt-14 sm:pb-16">
          <div
            className={cn(
              column,
              'grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 gap-y-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]',
            )}
          >
            <HungTicket bar="up_next">
              <h1
                id="top-title"
                className="font-heading text-[2.2rem] leading-[0.95] font-bold tracking-[-0.01em] text-balance uppercase sm:text-[3.6rem] xl:text-[4.25rem]"
              >
                The <span className="whitespace-nowrap">3D-print</span> queue you run yourself
              </h1>
              <p className="mt-4 max-w-[34rem] leading-normal text-ticket-muted sm:mt-5 sm:text-xl">
                Take requests from the people you print for, decide what prints next and on which printer, and follow every copy from{' '}
                {first} to {last}.
              </p>
              <p className="mt-5 flex gap-[3px] sm:mt-6" aria-hidden="true">
                {workflow.statuses.map(({ id }) => (
                  <span key={id} data-stage={id} className="size-2 rounded-[2px] bg-(--stage)" />
                ))}
              </p>
              <Perforation className="mt-3" />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <p className="font-mono text-[11px] text-ticket-muted uppercase">Free · AGPL-3.0</p>
                <ButtonLink size="xl" href={SIGN_UP_PATH} onClick={() => trackLink('create_workspace', 'hero')}>
                  Create a free workspace
                </ButtonLink>
              </div>
            </HungTicket>

            <HungTicket bar="ink" id="docker" style={{ '--settle-delay': '90ms' } as CSSProperties}>
              <h2 className="font-heading text-[1.6rem] leading-none font-bold uppercase">Run it yourself</h2>
              <p className="mt-3 mb-4 text-[0.95rem] leading-relaxed text-ticket-muted">
                One container on your own hardware. SQLite by default, PostgreSQL when you want it.
              </p>
              <CommandBlock />
              <Perforation className="mt-5" />
              <ul className="mt-4 flex flex-wrap gap-2">
                <li>
                  <ButtonLink
                    variant="outline"
                    href={SELF_HOSTING_GUIDE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackLink('self_hosting_guide', 'hero')}
                  >
                    Self-hosting guide <ExternalLinkIcon />
                  </ButtonLink>
                </li>
                {[truenas, unraid].map(([platform, name, href]) => (
                  <li key={platform}>
                    <ButtonLink
                      variant="outline"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackLink(`${platform}_catalogue`, 'hero')}
                    >
                      <NasMark className="size-3.5" platform={platform} />
                      {name}
                      <span className="sr-only"> app catalogue</span>
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </HungTicket>
          </div>
        </section>

        <section id="board" aria-labelledby="board-title" className="border-t border-border py-14 sm:py-20">
          <div className={cn(column, 'grid gap-x-12 gap-y-8 lg:grid-cols-[15rem_1fr]')}>
            <header>
              <h2 id="board-title" className="font-heading text-[2rem] leading-none font-bold text-balance uppercase">
                One board, five stages
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
                The board is laid out like an expo pass: what to print next hangs in the middle, every printer shows what it is doing, and
                finished prints wait for pickup on the right.
              </p>
            </header>
            <figure className="relative min-w-0 lg:pb-10">
              <div className="overflow-hidden rounded-lg border border-border max-sm:hidden">
                <Shot
                  name="board"
                  wide
                  width={2000}
                  height={1250}
                  sizes="(min-width: 1296px) 56rem, (min-width: 1024px) 70vw, 100vw"
                  alt="The STL Quest board for a print farm: the queue on the left, tickets hanging in firing order with printers idle and busy above them, and finishing and ready shelves on the right."
                />
              </div>
              <div className="mx-auto w-[14rem] overflow-hidden rounded-[1.4rem] border-[5px] border-shell shadow-2xl ring-1 ring-foreground/10 sm:hidden lg:absolute lg:-left-8 lg:-bottom-2 lg:block lg:w-[11.5rem] xl:w-[13rem]">
                <Shot
                  name="phone"
                  width={600}
                  height={1299}
                  sizes="14rem"
                  alt="The same board on a phone: a stage bar to jump between lanes, and the next ticket to fire."
                />
              </div>
              <figcaption className="mt-3 font-mono text-[11px] text-muted-foreground uppercase lg:pl-[11rem] xl:pl-[12.5rem]">
                A demo print farm · 27 printers · on desktop and phone
              </figcaption>
            </figure>
          </div>
          <ol className={cn(column, 'mt-12 grid gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-5')}>
            {workflow.statuses.map(({ id, label }) => (
              <li key={id} data-stage={id} className="border-t-[6px] border-(--stage) pt-3">
                <h3 className="font-heading text-[1.1rem] leading-none font-bold uppercase">{label}</h3>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-muted-foreground">{stageNotes[id]}</p>
              </li>
            ))}
          </ol>
        </section>

        <SpecLine
          id="copies"
          title="Track the copy, not the request"
          purpose={
            <>
              <p>
                A request for six is six copies. Start three, finish two, hand one over: each copy sits in its own stage, and the board
                draws every one as a cell in that stage&rsquo;s colour.
              </p>
              <p>Requesters see the same cells under My requests, so nobody has to ask whether theirs is done.</p>
            </>
          }
        >
          <CopyDemo />
        </SpecLine>

        <SpecLine
          id="catalogues"
          title="Pick it from a catalogue"
          purpose={
            <p>
              Printers, materials, and equipment come from catalogues that ship with the app, so you choose a product instead of typing its
              specs. The only figures you type are the prices you paid.
            </p>
          }
        >
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {catalogues.map(([name, description]) => (
                <li key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                  <h3 className="font-semibold">{name}</h3>
                  <p className="text-[0.95rem] leading-relaxed text-muted-foreground">{description}</p>
                </li>
              ))}
            </ul>
            <figure>
              <div className="overflow-hidden rounded-lg border border-border">
                <Shot
                  name="filament"
                  width={900}
                  height={634}
                  sizes="(min-width: 1280px) 22rem, 100vw"
                  alt="Adding Prusament PLA from the filament catalogue: the product with its material and density, and a grid of its colour swatches."
                />
              </div>
              <DemoCaption>A filament from the catalogue, picked by its colour</DemoCaption>
            </figure>
          </div>
        </SpecLine>

        <SpecLine
          id="costs"
          title="Quote it before you print it"
          purpose={
            <p>
              Enter your slicer&rsquo;s totals and get a suggested price built from what your printer, material, wear parts, electricity,
              and time cost.
            </p>
          }
        >
          <div className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <ul className="space-y-5">
              <Point title="Rough quote in seconds">
                Material and print time from the slicer, plates and hands-on minutes from you. Every rate shows what it costs per hour,
                plate, or millilitre.
              </Point>
              <Point title="A batch at once">
                Select prints on the board and choose Estimate price to quote them together, each on its assigned printer.
              </Point>
              <Point title="Compare printers">See the same job priced across every printer that could run it.</Point>
            </ul>
            <figure>
              <div className="overflow-hidden rounded-lg border border-border">
                <Shot
                  name="quote"
                  width={800}
                  height={1123}
                  sizes="22rem"
                  alt="A rough quote: the suggested price, what it costs to make and the profit a 66.67% markup adds, and the cost basis of the printer, its wear parts, the resin, and wash and cure."
                />
              </div>
              <DemoCaption>A typical resin job on the demo print farm</DemoCaption>
            </figure>
          </div>
        </SpecLine>

        <SpecLine
          id="usage"
          title="Know what it used"
          purpose={
            <p>
              Turn on usage and stock tracking and the board asks what each print used as it moves on, so stock, maintenance, and spend
              count themselves.
            </p>
          }
          aside={<OptionalTag />}
        >
          <ul className="grid gap-5 sm:grid-cols-2">
            <Point title="Asked at the step">
              Moving prints into Printing or Finishing opens a short sheet: what did you use? Prefilled, skippable, undoable.
            </Point>
            <Point title="Stock and reorder levels">Resin, filament, and supplies count down as they are used.</Point>
            <Point title="Wear and lifespan">
              Tanks, films, and nozzles show how close they are to due, with Replaced beside them, and each printer its print hours against
              its lifespan.
            </Point>
            <Point title="Spend">What prints cost at the prices you paid then, including failed runs and waste.</Point>
          </ul>
          <figure className="mt-8">
            <div className="overflow-hidden rounded-lg border border-border">
              <Shot
                name="spend"
                width={1400}
                height={631}
                sizes="(min-width: 1296px) 56rem, (min-width: 1024px) 70vw, 100vw"
                alt="Spend for the month: the total spent, prints, failed runs, and wasted stock, with a chart of spend per day."
              />
            </div>
            <DemoCaption>A month of spend on the demo print farm</DemoCaption>
          </figure>
        </SpecLine>

        <SpecLine
          id="run"
          title="Run it your way"
          purpose={
            <>
              <p>The same application either way, and your files stay yours.</p>
              <p>
                STL Quest keeps the queue: who asked for what, which printer it is on, and how far along it is. Model files live where you
                choose.
              </p>
            </>
          }
        >
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 gap-y-10 md:grid-cols-2">
            <HungTicket bar="ink">
              <h3 className="font-heading text-[1.4rem] leading-none font-bold uppercase">On your own server</h3>
              <ul className="mt-4 space-y-2 text-[0.95rem] leading-relaxed text-ticket-muted">
                <li>
                  One Docker container, with the{' '}
                  <a
                    className="text-ticket-foreground underline decoration-ticket-foreground/30 underline-offset-4 hover:decoration-ticket-foreground"
                    href="#docker"
                  >
                    command at the top
                  </a>
                  , or Docker Compose.
                </li>
                <li>
                  An app in the {truenas[1]} and {unraid[1]} catalogues.
                </li>
                <li>No plans: files live wherever you put them.</li>
              </ul>
              <Perforation className="mt-5" />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[11px] text-ticket-muted uppercase">SQLite or PostgreSQL</p>
                <ButtonLink
                  variant="outline"
                  href={`${LATEST_DOCUMENTATION_URL}/deployment.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackLink('deployment_guide', 'run_it')}
                >
                  Deployment guide <ExternalLinkIcon />
                </ButtonLink>
              </div>
            </HungTicket>
            <HungTicket bar="up_next">
              <h3 className="font-heading text-[1.4rem] leading-none font-bold uppercase">Hosted at stl.quest</h3>
              <table className="mt-3 w-full text-[0.95rem]">
                <caption className="sr-only">Hosted storage plans</caption>
                <tbody className="divide-y divide-ticket-foreground/15">
                  {Object.values(storagePlans).map((plan) => (
                    <tr key={plan.name}>
                      <th scope="row" className="py-2 text-left font-semibold">
                        {plan.name}
                      </th>
                      <td className="py-2 font-mono text-[0.8rem] text-ticket-muted">{gigabytes.format(plan.quotaBytes / 1e9)}</td>
                      <td className="py-2 text-right font-mono text-[0.8rem]">${plan.monthlyPrice}/month</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm leading-relaxed text-ticket-muted">
                Storage for model files, shared across the workspaces you own. A workspace can connect storage you manage instead.
              </p>
              <Perforation className="mt-5" />
              <div className="mt-4 flex justify-end">
                <ButtonLink variant="outline" href={SIGN_UP_PATH} onClick={() => trackLink('create_workspace', 'run_it')}>
                  Create a free workspace
                </ButtonLink>
              </div>
            </HungTicket>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold">Storage</h3>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {STORAGE_PROVIDERS.map((provider) => (
                  <li key={provider} className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-xs">
                    {provider}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">
                Switching providers migrates the files you already have.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">Models</h3>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {MODEL_FORMATS.map((format) => (
                  <li key={format} className="rounded-[3px] border border-border bg-card px-2 py-1 font-mono text-xs uppercase">
                    {format}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">
                Interactive 3D previews and thumbnails, or a saved link to the model page instead of a file.
              </p>
            </div>
          </div>
        </SpecLine>

        <SpecLine
          id="boundary"
          title="What it leaves to other tools"
          purpose={<p>STL Quest runs the queue. The jobs around it stay with the tools that already do them well.</p>}
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 [&>li:last-child]:max-xl:sm:col-span-2">
            {OUTSIDE_THE_PRODUCT.map(({ job, instead }) => (
              <li key={job} className="rounded-[3px] border border-dashed border-foreground/30 px-4 py-3">
                <h3 className="font-heading text-lg leading-none font-bold text-muted-foreground uppercase">{job}</h3>
                <p className="mt-2 text-[0.9rem] leading-relaxed text-muted-foreground">{instead}</p>
              </li>
            ))}
          </ul>
        </SpecLine>

        <section aria-labelledby="close-title" className="on-shell border-t-[0.375rem] border-rail bg-shell py-14 sm:py-20">
          <div className={cn(column, 'grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]')}>
            <div>
              <h2 id="close-title" className="font-heading text-[2.4rem] leading-[0.95] font-bold text-balance uppercase sm:text-[3rem]">
                One printer or a whole farm
              </h2>
              <p className="mt-4 max-w-[36rem] text-lg leading-normal text-muted-foreground">
                The board stays one screen at either end: a handful of requests on one printer, or hundreds of copies across a fleet.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink size="xl" href={SIGN_UP_PATH} onClick={() => trackLink('create_workspace', 'close')}>
                Create a free workspace
              </ButtonLink>
              <ButtonLink size="xl" variant="outline" href="#docker" onClick={() => trackLink('docker_command', 'close')}>
                Run it yourself
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}
