import { LATEST_DOCUMENTATION_URL, REPOSITORY_URL } from '@/client/sourceCode'
import { MODEL_FORMATS } from '@/core/assetKeys'
import { formatBytes } from '@/core/format'
import { storagePlans } from '@/core/plans'
import { SLICERS } from '@/core/slicers'
import { workflow } from '@/core/workflow'
import {
  LOCAL_STORAGE,
  NAS_CATALOGUES,
  OUTSIDE_THE_PRODUCT,
  PAGES,
  SELF_HOSTING_GUIDE_URL,
  SIGN_UP_PATH,
  SITE_ORIGIN,
  STORAGE_PROVIDERS,
} from './site'

const list = (items: readonly string[], type: Intl.ListFormatType = 'conjunction') => new Intl.ListFormat('en', { type }).format(items)

/** The site summarised for answer engines (https://llmstxt.org), with its facts read from the application rather than restated. */
export function llmsText() {
  const stages = list(workflow.statuses.map((status) => status.label))
  const opensInSlicer = list(
    SLICERS.filter((slicer) => slicer.openUrl).map((slicer) => slicer.name),
    'disjunction',
  )
  const [truenas, unraid] = NAS_CATALOGUES
  const remoteStorage = STORAGE_PROVIDERS.filter((provider) => provider !== LOCAL_STORAGE)
  return `# STL Quest

> ${PAGES[0].description.replace('STL Quest is a', 'A')} Requesters submit models or source links; the operator orders the queue, matches each job to a compatible resin or filament printer, and tracks every copy through ${stages}. Self-host it with Docker, TrueNAS SCALE, or Unraid, or use the free hosted version at stl.quest.

STL Quest replaces spreadsheets and chat threads for hobbyists printing for friends, print farms, and small print businesses. Each copy of a request moves through production on its own, so a request for six copies is six units of work, not one card.

## What it does

- The board: the queue as a backlog, tickets hanging in firing order, printing grouped by printer with idle printers flagged, and finished prints grouped by who is collecting them. It works on phones as well as desktops.
- Catalogues: printers, resins, filaments (from SpoolmanDB, with every colour), equipment, and wear parts for each printer model ship with the app, so operators pick products instead of typing specifications and enter only their own prices.
- Quotes: a calculator turns the slicer's material and print time into a suggested price from printer, material, wear-part, electricity, and labour costs, and prices a batch of prints selected on the board.
- Slicers: each printer names the slicer its prints go to, and a material can name its own. A print opens straight in ${opensInSlicer} through a short-lived link, or downloads for any other slicer, named with its request tag such as \`SQ-142 Plasma.3mf\`.
- Usage and stock, off until an admin turns it on: the board asks what each print used as it moves into printing and finishing, and counts stock against reorder levels, wear-part maintenance, and spend.

## Ways to run it

- [Self-hosting guide](${SELF_HOSTING_GUIDE_URL}): one Docker container, \`ghcr.io/richardsolomou/stl.quest:latest\`, SQLite by default or PostgreSQL through \`DATABASE_URL\`
- [Deployment guide](${LATEST_DOCUMENTATION_URL}/deployment.md): Docker Compose, environment variables, reverse proxies, health checks, backups, and upgrades
- [${truenas[1]} SCALE / HexOS app](${truenas[2]})
- [${unraid[1]} Community Apps](${unraid[2]})
- [Hosted version](${SITE_ORIGIN}${SIGN_UP_PATH}): create a free workspace without running a server

## Common questions

- Is STL Quest free? Yes. The software is free and open source under AGPL-3.0, and self-hosted installs have no storage plans: files live wherever the operator puts them. Hosted accounts include ${formatBytes(storagePlans.free.quotaBytes)} of storage on the ${storagePlans.free.name} plan, with optional paid plans for larger libraries, or can connect storage they manage: [storage guide](${LATEST_DOCUMENTATION_URL}/storage.md).
- Where are model files stored? In a folder on the server, in ${list(remoteStorage, 'disjunction')} storage the operator connects, or in included hosted storage. Settings → Storage migrates existing files when switching providers.
- Which file formats does it preview? ${list(MODEL_FORMATS.map((format) => format.toUpperCase()))}, with interactive previews and generated thumbnails. Links to MakerWorld and Printables get a cover preview, and any linked print can take a cover image someone pastes or uploads.
- Does it work with both resin and filament printers? Yes. Mixed fleets are supported, and each job is matched to a printer by build volume and print type.
- How is the queue ordered? Round robin between requesters, oldest first, requester priority, or manual ordering.
- Can several groups share one install? Yes. Each workspace has its own board, printers, members, and storage, and users can join several workspaces by invitation or be added directly by a super admin.
- How do people sign in? Email and password, social login, OpenID Connect single sign-on, and two-factor authentication.
- Does it collect telemetry? Anonymous telemetry is on by default, never includes model files, names, notes, or other request content, and can be turned off: [telemetry page](${LATEST_DOCUMENTATION_URL}/telemetry.md).

## What it does not do

STL Quest does not ${list(
    OUTSIDE_THE_PRODUCT.map(({ clause }) => clause),
    'disjunction',
  )}. The operator's slicer remains the source of truth for orientation, arrangement, supports, infill, and material use, and quotes are figures for the operator, not payments.

## Links

- [Source code and README](${REPOSITORY_URL})
- [Releases and changelog](${REPOSITORY_URL}/releases)
${PAGES.slice(1)
  .map((page) => `- [${page.title.replace(' — STL Quest', '')}](${SITE_ORIGIN}${page.path})`)
  .join('\n')}
`
}
