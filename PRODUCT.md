# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the operator.** A workspace owner or admin who runs a print queue for other people — a hobbyist printing for friends, or someone running a small print farm or print business. They work at a desk beside a fleet of resin and filament printers, moving between the board and the machines throughout a session, deciding what to print next, which printer it goes on, and where each copy is in production. When operator and requester needs conflict, the operator's experience wins.

**Secondary: the requester.** A member of the workspace who submits print requests — uploading a model or saving a source link with quantity, notes, and a preferred print type — then checks back to see where their prints are. Low-frequency use; their path must stay simple, but it is not what the product is tuned around.

**Also present: the super admin.** On a self-hosted install, the person who owns the server: user accounts, sign-in methods, email delivery, telemetry, and diagnostics.

## Product Purpose

STL Quest replaces scattered spreadsheets and chat threads with one shared 3D-print request and production queue. Requests come in, the operator orders them and assigns compatible printers, and every individual copy is tracked through **Queue → Up next → Printing → Finishing → Ready**. Success is an operator who always knows what to print next and never loses track of a copy, and requesters who stop asking "is mine done yet?".

## Positioning

Two claims a neighboring tool cannot truthfully copy:

1. **Per-copy tracking through production.** A request for six copies is not one card — each copy moves through its own stage independently. A generic board or spreadsheet tracks the request; STL Quest tracks the units of work.
2. **You own the whole stack.** Self-hosted: the app, database, model files, and full history stay on the operator's server, with their choice of storage backend. Not a SaaS with an export button.

Supporting, not headline: dimension-aware auto-assignment across mixed resin and filament fleets, and fair queue ordering with manual requester priorities.

## Operating Context

- **The board is the product's center of gravity.** Five status columns, drag-and-drop, filtering, search, multi-select, board presence showing who else is looking, and realtime updates with no extra service to install.
- **Workspaces are the tenancy boundary.** Each has its own board, printers, members, settings, and storage. Users can belong to several by invitation. Roles are owner / admin / member.
- **Intake is two-track:** uploaded model files, or saved source links. Links to MakerWorld, Printables, MyMiniFactory, Cults3D, and Thingiverse resolve a cover preview.
- **Models are viewed in-app** through interactive STL previews and generated thumbnails; geometry, thumbnail, and preview assets are generated asynchronously per request.
- **The slicer stays outside.** Orientation, arrangement, supports, infill, and material use are the operator's slicer's job, not STL Quest's.
- **Storage is pluggable:** local filesystem, WebDAV, S3-compatible, Dropbox, Google Drive, OneDrive, or Box, with guided migration when switching.
- **Deployment is operator-run:** Docker, Docker Compose, TrueNAS SCALE / HexOS, or Unraid, with SQLite by default and PostgreSQL optional. Automatic migrations, backups, and health checks.

## Capabilities and Constraints

- **Product boundary (hard):** self-hosted request intake and queue management only. Payments, shipping, slicing, printer control, marketplaces, a public gallery, and general-purpose automation stay out of the core application.
- **Configuration lives in settings, not environment variables.** Anything a user configures belongs in workspace settings or deployment settings; env vars are for filesystem paths, operational controls, recovery, and managed-deployment overrides.
- **Two distribution shapes.** Self-hosted installs and a hosted service share one codebase. Hosted-only concerns (storage plans, billing) must never surface in the TrueNAS or Unraid packages.
- **Hosted storage plans:** Free (1 GB), Supporter (25 GB, $5/mo), Pro (100 GB, $10/mo), shared across three owned workspaces; other workspaces connect their own remote storage.
- **Auth:** email/password, social login, and two-factor authentication. On a fresh install the first account created becomes the super admin.
- **Telemetry is anonymous and on by default,** disableable at any time. It never carries names, emails, request content, filenames, user-provided URLs, storage endpoints, or credentials. `docs/telemetry.md` is the public contract for exactly what is sent.
- **Printer catalog is generated,** not hand-authored: manufacturer data plus overrides produce `printer-catalog/catalog.generated.json` and printer preset images.
- **License:** AGPL-3.0-only. The source is public and self-hosters can read and modify everything.
- **Open:** there is no marketing or landing surface in this repository. The unauthenticated front door at `stl.quest` is the sign-in screen. If a marketing surface is ever wanted, whether it lives here is undecided.

## Brand Commitments

- **Name:** STL Quest. Domain `stl.quest`. Logo is `public/favicon.svg`.
- **Voice:** plain, concrete, operator-to-operator. States what the product does and where its edges are, without hedging or marketing inflation. The README's willingness to say "STL Quest does not slice models or control printers" is the register.
- **Terminology is fixed and load-bearing:** the five statuses are **Queue, Up next, Printing, Finishing, Ready**. Print types are **resin** and **filament**. Workspace roles are **owner, admin, member**.

## Evidence on Hand

- Working product at `stl.quest`, released publicly (v1.27.0 at time of writing) with a full CHANGELOG.
- Product tour animation hosted at `https://stl.quest/product-tour.gif` (not in-repo).
- Public documentation: `docs/deployment.md`, `docs/storage.md`, `docs/telemetry.md`, `docs/webdav.md`.
- Distribution listings: TrueNAS Apps catalog, Unraid Community Apps, GHCR container images.
- Generated printer catalog with manufacturer specifications and preset images under `public/printer-presets/`.
- **No testimonials, named customers, user counts, benchmarks, or case studies exist.** Do not invent them.

## Product Principles

1. **The operator's next decision is the product.** Every surface should shorten the distance between opening the board and knowing what to print next.
2. **Track the copy, not the request.** Wherever a count appears, the unit of truth is the individual copy and its stage.
3. **Say what it does not do.** The boundary — no slicing, no printer control, no marketplace — is a feature, stated plainly rather than left implied.
4. **The operator owns their data.** Nothing may quietly depend on a hosted service, and self-hosted installs must never be shown hosted-only configuration.
5. **Workspaces do not leak.** Tenancy is absolute in the data layer and must remain legible in the interface — the user should always know which workspace they are in.

## Accessibility & Inclusion

No standard has been established. Future work must not assume one, and must not claim conformance that was never agreed. Note for whoever decides later: the board's drag-and-drop is the sharpest open question, since it currently has no confirmed keyboard equivalent.
