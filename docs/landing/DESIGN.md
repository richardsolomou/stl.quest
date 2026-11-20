---
name: STL Quest website
description: The hosted landing pages, set on the application's own pass at marketing scale.
colors:
  thermal-red: '#cf3119'
  thermal-red-night: '#ff6447'
  thermal-ink: '#17181a'
  shell-ink-night: '#0b0c0d'
  shell-bone: '#f2f1ec'
  shell-graphite: '#a9adb0'
  brushed-steel: '#dcdfdd'
  steel-plate: '#eef0ee'
  steel-recess: '#cdd1cf'
  steel-rule: '#b7bcba'
  steel-input: '#9fa5a3'
  field-white: '#fbfbfa'
  popover-paper: '#f6f7f5'
  rail-steel: '#8d9391'
  worn-graphite: '#4a4f53'
  ticket-paper: '#fbfaf5'
  ticket-graphite: '#575b5e'
  focus-blue: '#1f5fd1'
  night-steel: '#131517'
  night-plate: '#1b1e21'
  night-paper: '#26292d'
  night-bone: '#ecebe5'
  night-graphite: '#a2a8ad'
  night-rule: '#33383d'
  night-rail: '#5a6066'
  stage-queue: '#6c7175'
  stage-up-next: '#2360c4'
  stage-printing: '#f0a40f'
  stage-finishing: '#7c4cc4'
  stage-ready: '#1f7a43'
  stage-queue-night: '#858b90'
  stage-up-next-night: '#5b8ff0'
  stage-printing-night: '#f2ad25'
  stage-finishing-night: '#a57ee8'
  stage-ready-night: '#4cb873'
typography:
  display:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '4.25rem'
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: '-0.01em'
  headline:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '2rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 'normal'
  close:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '3rem'
    fontWeight: 700
    lineHeight: 0.95
    letterSpacing: 'normal'
  ticket-title:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.4rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 'normal'
  stage-label:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.1rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 'normal'
  lede:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '1.25rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  body:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  purpose:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '0.95rem'
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: 'normal'
  point-title:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 'normal'
  command:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.625
    letterSpacing: 'normal'
  stub:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: '11px'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
rounded:
  cell: '2px'
  paper: '3px'
  control: '0.28125rem'
  plate: '0.375rem'
  phone: '1.4rem'
spacing:
  column: 'min(72rem, calc(100% - 2rem))'
  margin-column: '15rem'
  bar: '3.25rem'
  section: '5rem'
  section-narrow: '3.5rem'
  spec-gutter: '3rem'
  ticket-pad: '1.5rem'
  rail: '0.375rem'
components:
  button-commit:
    backgroundColor: '{colors.thermal-red}'
    textColor: '#ffffff'
    rounded: '{rounded.control}'
    padding: '0 1rem'
    height: '2.75rem'
  button-commit-hover:
    backgroundColor: 'color-mix(in oklch, #cf3119, #17181a 14%)'
  button-commit-night:
    backgroundColor: '{colors.thermal-red-night}'
    textColor: '{colors.thermal-ink}'
  button-outline:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.control}'
    padding: '0 0.625rem'
    height: '2rem'
  button-outline-hover:
    backgroundColor: '{colors.steel-recess}'
  hung-ticket:
    backgroundColor: '{colors.ticket-paper}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.paper}'
    padding: '1.5rem 1.5rem 1.25rem'
  hung-ticket-night:
    backgroundColor: '{colors.night-paper}'
    textColor: '{colors.night-bone}'
  command-plate:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    typography: '{typography.command}'
    rounded: '{rounded.control}'
    padding: '0.75rem'
  steel-plate:
    backgroundColor: '{colors.steel-plate}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.plate}'
    padding: '1.25rem'
  copy-cell:
    backgroundColor: '{colors.stage-up-next}'
    rounded: '{rounded.cell}'
    size: '0.5rem'
  stage-count-chip:
    backgroundColor: '{colors.stage-up-next}'
    textColor: '#ffffff'
    typography: '{typography.stub}'
    rounded: '{rounded.paper}'
    padding: '0.125rem 0.375rem'
  spec-chip:
    backgroundColor: '{colors.steel-plate}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.paper}'
    padding: '0.25rem 0.5rem'
  ghost-slot:
    backgroundColor: 'transparent'
    textColor: '{colors.worn-graphite}'
    rounded: '{rounded.paper}'
    padding: '0.75rem 1rem'
  site-bar:
    backgroundColor: '{colors.brushed-steel}'
    textColor: '{colors.worn-graphite}'
    height: '{spacing.bar}'
  closing-band:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    padding: '5rem 0'
---

<!-- markdownlint-disable MD024 MD036 MD025 -->
<!-- The DESIGN.md spec requires the bolded North Star line (MD036), a "Named Rules" heading per section (MD024),
     and typography role keys that markdownlint can mistake for a front-matter document title (MD025). -->

# Design System: STL Quest website

## Overview

**Creative North Star: "The pass, seen from the counter"**

The hosted landing pages (`/`, `/home`, `/terms`, `/privacy`) do not have a marketing world of their own. They stand on the application's pass: brushed steel by day and night steel after dark, paper tickets hung from a steel rail, black thermal ink, red as the second ink, and five stage colours that own whole regions. The decision is deliberate. The site is a surface of one product whose name, palette, and type are not the website's to reinterpret (`docs/landing/PRODUCT.md`, Brand Commitments); a visitor who signs up should land in the world they were just shown; and real screenshots only read as evidence when the page around them speaks the same language as the pixels inside them. A separate landing palette would make every screenshot look like a quotation from somewhere else.

Like the application, the pages follow the visitor's light or dark scheme. Every colour comes from `src/theme.css` through `src/styles.css`, swapped by `:root[data-theme='dark']`; nothing locks `color-scheme` and the head carries no `theme-color` meta. What the landing adds is scale and argument, not material: the same tokens spent on fewer, larger elements. The offer is hung as tickets on a rail; every claim after that is a spec-sheet line with its name in a margin column and the running board as evidence beside it; what the product refuses is drawn as empty slots.

The page reads top to bottom as one pass: the rail of offers, the board, the copy ticket the visitor can move, catalogues, quotes, usage, how to run it, what it leaves to other tools, and an ink band to close. Product facts come from `src/core` (stages and their order, plans, model formats, storage providers), never restated in prose.

**Key Characteristics:**

- The application's Pass tokens, unchanged, in both schemes.
- A hung-ticket rail as the hero, not a split hero over icon cards.
- One solid red per view, on Create a free workspace.
- Stage colours as flat fills, in board order, sourced from `data-stage`.
- Spec-sheet lines: a 15rem margin column beside the evidence.
- Real screenshots of the running app in the visitor's theme.
- Mono only for what a machine prints or reads.

## Colors

The application's palette, read live from `src/theme.css`; this file names the values the landing pages actually render. Each light token has a night counterpart under `data-theme='dark'`.

### Primary

- **Thermal Red** (`{colors.thermal-red}`, night `{colors.thermal-red-night}`): The commit ink. On the landing pages it fills exactly one control per view: Create a free workspace in the hero ticket and in the closing band. Every other path, including the same action in the site bar and the hosted ticket, is an outline button.

### Secondary

- **Stage colours** (Queue `{colors.stage-queue}`, Up next `{colors.stage-up-next}`, Printing `{colors.stage-printing}`, Finishing `{colors.stage-finishing}`, Ready `{colors.stage-ready}`; night variants alongside): The five stages in production order, applied through `[data-stage]` so the hero's stage cells, the lead ticket's bar, the legend bars, the copy ticket's cells and count chips all share one source. The Up next blue also tints text selection.

### Tertiary

- **Focus Blue** (`{colors.focus-blue}`): Focus rings only (3px at 50%). Never a fill.

### Neutral

- **Brushed Steel** (`{colors.brushed-steel}`; night `{colors.night-steel}`): The page ground and the site bar.
- **Steel Plate** (`{colors.steel-plate}`; night `{colors.night-plate}`): Evidence plates: the copy-ticket frame, the catalogue list, spec chips.
- **Steel Recess** (`{colors.steel-recess}`): Hover fill for outline and ghost controls.
- **Steel Rule** (`{colors.steel-rule}`; night `{colors.night-rule}`): Section rules between spec lines, plate and screenshot outlines, point dividers.
- **Steel Input** (`{colors.steel-input}`) and **Field White** (`{colors.field-white}`): The outline button's stroke and fill.
- **Popover Paper** (`{colors.popover-paper}`): The narrow-width navigation sheet.
- **Rail Steel** (`{colors.rail-steel}`; night `{colors.night-rail}`): The rail strip tickets hang from (at 70%), the hanger tab, and the closing band's top edge.
- **Thermal Ink** (`{colors.thermal-ink}`; night `{colors.night-bone}` as text): Headings and body. As the shell (`{colors.thermal-ink}`, night `{colors.shell-ink-night}`) it is the command plate, the docket's ink bar, the phone bezel, and the closing band, with Shell Bone (`{colors.shell-bone}`) and Shell Graphite (`{colors.shell-graphite}`) text inside `.on-shell`.
- **Worn Graphite** (`{colors.worn-graphite}`; night `{colors.night-graphite}`): Purpose paragraphs, captions, the footer, ghost slots.
- **Ticket Paper** (`{colors.ticket-paper}`; night `{colors.night-paper}`) and **Ticket Graphite** (`{colors.ticket-graphite}`): Hung tickets and the copy ticket's paper slips, with their muted text.

### Named Rules

**The One Red Rule.** A view carries at most one solid Thermal Red control, and it is always Create a free workspace. The site bar's copy of that action is an outline so the hero ticket keeps the only red above the fold; the hosted ticket's copy is an outline because the hero's red is still in reach.

**The Stage Owns the Region Rule.** A stage colour is a flat fill read from `data-stage`, in board order, and only where it means that stage. Never a gradient, a tint for decoration, or a sixth hue.

**The No Marketing Palette Rule.** The landing pages introduce no colour the application does not have. A new need is met from `src/theme.css` or not at all.

## Typography

**Display Font:** Oswald 700 (with `system-ui, sans-serif`), through `--face-heading`
**Body Font:** IBM Plex Sans 400 and 600 (with `system-ui, sans-serif`), through `--face-sans`
**Label/Mono Font:** IBM Plex Mono 400 (with `ui-monospace, monospace`), through `--face-mono`

**Character:** Condensed uppercase Oswald is the ticket name and the section head: a printed order, not a startup headline. Plex Sans carries every sentence; Plex Mono carries only what a machine prints or reads. These are the faces that ship; the root `DESIGN.md` frontmatter still names Archivo and Martian Mono, which no longer match the `--face-*` tokens.

The root is 18px (`src/styles.css`), so every rem here is 18px and numbers are tabular throughout. `landing.css`, loaded only by the landing routes, redeclares the four faces above the fold with `font-display: optional`, and `landingHead` preloads them, trading a small chance of fallback for no layout shift.

### Hierarchy

- **Display** (Oswald 700, 2.2rem → 3.6rem at 40rem → `{typography.display}` at 80rem, 0.95, -0.01em, uppercase, balanced): The H1, once, on the lead ticket.
- **Close** (Oswald 700, 2.4rem → 3rem at 40rem, 0.95, uppercase): The closing band's head. Legal pages use 2.6rem for their H1.
- **Headline** (Oswald 700, 2rem, 1, uppercase, balanced): Spec-line titles in the margin column.
- **Ticket title** (Oswald 700, 1.4rem, uppercase; 1.6rem on the hero docket): Names on hung tickets.
- **Stage label** (Oswald 700, 1.1rem, uppercase): Stage legend heads; ghost-slot jobs at 1.125rem; legal section heads at 1.25rem. The copy ticket's stage labels are 0.875rem tracked 0.015em, as on the board.
- **Lede** (Plex Sans 400, 1.25rem from 40rem, max 34rem): The hero paragraph. The closing band's line is 1.125rem.
- **Body** (Plex Sans 400, 1rem/1.5): Prose; legal text runs at 55ch, about 73 characters a line.
- **Purpose** (Plex Sans 400, 0.95rem/1.625): Margin-column paragraphs and point descriptions; stage notes at 0.9rem.
- **Point title** (Plex Sans 600, 1rem): Points, catalogue names, plan names.
- **Command** (Plex Mono 400, 0.75rem/1.625): The Docker command.
- **Stub** (Plex Mono 400, 11px, uppercase): Ticket stubs (Free · AGPL-3.0, SQLite or PostgreSQL), demo captions, the optional tag, the legal effective date, stage count chips. Plan figures are 0.8rem mono; spec chips 0.75rem mono; the footer 0.75rem mono uppercase.

### Named Rules

**The Machine Voice Rule.** Mono is for what a machine prints or reads: the command, plan sizes and prices, counts, captions, ticket stubs, storage and format names, and the footer colophon. Never for prose, and never to make a sentence look technical.

**The No Eyebrow Rule.** Nothing sits above a heading. A stub or caption belongs at the foot of the thing it labels, as a ticket's does.

## Layout

One measure for every band: `{spacing.column}`, so the page keeps a single left edge from bar to footer. The site bar is `{spacing.bar}` tall over a hairline rule; below 64rem its links fold into a sheet.

The hero is the rail: from 64rem a two-track grid (1.55fr and 1fr, 1.5rem apart) holds the lead ticket and the ink docket side by side, each hanging from its own stretch of rail so together they read as one. Below 64rem they stack.

Every section after it is a **spec line**: a top rule in Steel Rule, `{spacing.section-narrow}` of vertical padding rising to `{spacing.section}` at 40rem, and from 64rem a grid of `{spacing.margin-column}` and the evidence, `{spacing.spec-gutter}` apart. The margin column holds the headline, the purpose, and any tag; the evidence column holds a plate, points, or a screenshot. Legal pages use the same margin column beside a 55ch body, with the header sticky from 64rem.

Evidence inside a line pairs a list with a 22rem screenshot from 48rem or 80rem; the stage legend runs five across from 64rem (two from 40rem); ghost slots run five across from 80rem, the last spanning both columns between 40rem and 80rem. Breakpoints are Tailwind's rem media queries, which resolve against the browser's 16px default: 40rem (640px), 48rem (768px), 64rem (1024px), 80rem (1280px).

### Named Rules

**The One Column Rule.** Every band shares the one measure. Only the closing band's ink runs edge to edge, and its content still sits in the column.

**The Margin Column Rule.** A spec line's name and purpose sit in the 15rem margin beside the evidence on wide screens, never as a title stacked over a full-width slab.

## Elevation & Depth

Flat steel, lifted paper. The ground, plates, rules, and bands carry no shadow; depth is tonal (steel, plate, paper) plus hairline rules. Paper hangs: a hung ticket and each copy-ticket slip carry the board's paper hang. The only other shadows belong to things that float over the page.

### Shadow Vocabulary

- **Paper hang** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.08), 0 10px 18px -12px rgb(0 0 0 / 0.5)`): Hung tickets and copy-ticket slips, as if the paper curls off the rail.
- **Float** (`box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25)`): The phone screenshot overlapping the board screenshot, and the narrow navigation sheet (with a 10% ink ring).

### Named Rules

**The Paper Lifts Rule.** Only paper casts a resting shadow. Steel plates, screenshot frames, the bar, and the closing band are flat.

## Shapes

Small, mechanical corners from the app's scale (`--radius` 0.375rem). Plates and screenshot frames use `{rounded.plate}`; buttons and the command plate `{rounded.control}`; paper, chips, ghost slots, and count chips are cut at `{rounded.paper}`; copy cells and stage swatches are `{rounded.cell}` squares. The phone capture sits in a `{rounded.phone}` bezel of 5px shell ink, the one soft corner, because it is a device.

A ticket is drawn from parts: a rail strip (`{spacing.rail}`, rail steel at 70%) overhanging the paper by 0.75rem each side, a 2rem by 1rem rail-steel hanger tab, a `{spacing.rail}` bar across the paper's top (the Up next stage for an offer, shell ink for a docket), and a dashed perforation at 25% ink between what a ticket is and what it carries. Dashes mean "not here yet" or "torn here": perforations, ghost slots (30% ink), the optional tag (40% ink), and the copy ticket's empty stages (25% ink).

### Named Rules

**The Dashed Means Absent Rule.** A dashed outline is a perforation or an empty slot. Never draw a solid thing with dashes.

## Components

### Buttons

The app's `Button` and `ButtonLink` (`src/components/ui/button.tsx`), unchanged. Links that look like buttons are `ButtonLink`, because Base UI's button forces button semantics on what it renders.

- **Shape:** `{rounded.control}`, Plex Sans 600 at 0.875rem.
- **Commit (default):** Thermal Red, white text (thermal ink at night), `xl` size (2.75rem, 1rem padding) for the hero and close. Hover mixes 14% ink into the red.
- **Outline:** Field White on a Steel Input stroke, hover to Steel Recess. Every secondary path: site bar action, hosted ticket, guides, catalogue links, Move a copy on, Run it yourself.
- **Ghost:** The copy icon on the command plate and the menu toggle.
- **Focus / Active:** 3px Focus Blue ring at 50%; a 1px press translate.

### Hung Ticket (signature)

Paper on its own stretch of rail (`HungTicket`, `Ticket.tsx`). The lead ticket carries the Up next bar, the H1, lede, five stage swatches, a perforation, the Free · AGPL-3.0 stub, and the red commit. The ink docket carries a shell-ink bar, Run it yourself, the command plate, a perforation, and outline links to the self-hosting guide, TrueNAS, and Unraid. Tickets settle onto the rail with `card-settle` (420ms, `cubic-bezier(0.16, 1, 0.3, 1)`), the docket 90ms after the lead, motion-safe only. The same pair returns under Run it your way: an ink docket for your own server, an Up next ticket for hosted plans from `storagePlans`.

### Command Plate

An `.on-shell` ink plate holding the Docker command in Command mono with a ghost copy button. The copy result swaps the icon to a success tick or a destructive alert, and the button's label says which, for two seconds.

### Copy Ticket (signature interaction)

`CopyDemo.tsx`: one request for six copies spread across the five stages on a steel plate. Each stage shows a stage swatch, Oswald label, and mono count chip, then a paper slip with the print name, ×n of 6, and the app's `CopyCells`. Move a copy on advances the copy nearest done; the landing slip replays `card-settle` (320ms) and its cells restamp with `cell-stamp` (320ms, 25ms stagger). Empty stages are dashed slots reading No copies here. A polite live region announces each move. Reduced motion turns off settle and stamp.

### Stage Legend

Five columns in board order, each under a 6px top bar in its stage colour, an Oswald stage label, and a purpose note keyed by stage ID.

### Themed Screenshot

`Shot.tsx` renders both captures into the markup; `landing.css` hides the other theme's with `display: none`, so its lazy image is never fetched. Wide captures add a 1200px `srcset` copy. Frames are a `{rounded.plate}` Steel Rule outline, flat. Images are `public/landing-{board,phone,quote,filament,spend}-{light,dark}.webp` (board also `-1200`): real screenshots of the running application in the demo print-farm workspace (`scripts/seedPowerUser.ts`), captured 2026-11-20 with Chrome DevTools at 2x and converted with cwebp. `public/social-card.png` is a crop of the light board capture. Each carries alt text describing what it shows.

### Demo Caption

A mono 11px uppercase `figcaption` in Worn Graphite under each screenshot, naming it as demo data (A demo print farm · 27 printers · on desktop and phone).

### Ghost Slot

What the product leaves to other tools, drawn as empty slots: a dashed 30% ink outline with no fill, the job in a muted Oswald label, and who does it instead. The list is `OUTSIDE_THE_PRODUCT` in `site.ts`, which `llms.txt` also reads.

### Spec Chip

Storage providers and model formats as uniform mono chips on Steel Plate with a Steel Rule outline. Uniform because the items are equivalent; colour would invent a distinction.

### Navigation

The site bar is the app's bar seen from outside: the `Brand` lockup, section links in Plex Sans 600 Worn Graphite turning to ink on hover, GitHub, Sign in, and an outline Create a free workspace. Below 64rem the links fold into a Popover Paper sheet with the float shadow, closed by Escape or the scrim. A skip link precedes it.

### Closing Band

An `.on-shell` band of shell ink edge to edge, topped by a `{spacing.rail}` rail-steel edge: the close head, one line, the red commit, and an outline Run it yourself back to the docket.

## Do's and Don'ts

### Do:

- **Do** take every colour, face, radius, and keyframe from `src/theme.css` and `src/styles.css`; follow the visitor's scheme.
- **Do** keep Thermal Red to Create a free workspace, once per view; every other action is an outline.
- **Do** apply stage colour through `data-stage`, in board order, from `workflow` in `src/core`.
- **Do** hang offers as tickets on the rail, and set every later section as a spec line with its name in the 15rem margin.
- **Do** show the product with real screenshots in both themes through `Shot`, captioned as demo data.
- **Do** draw what the product will not do as ghost slots from `OUTSIDE_THE_PRODUCT`.
- **Do** read stages, plans, model formats, and storage providers from `src/core`.
- **Do** keep landing faces on `font-display: optional` with their preloads in `landingHead`.

### Don't:

- **Don't** introduce a marketing palette, a gradient, or any colour the application lacks.
- **Don't** lock `color-scheme` or add a `theme-color` meta.
- **Don't** put a second solid red in a view, or use red for anything but the commit.
- **Don't** set prose in mono or put an eyebrow or kicker above a heading.
- **Don't** shadow steel, plates, or screenshot frames; only paper and floating layers lift.
- **Don't** colour a set of equivalent items such as storage providers.
- **Don't** add testimonials, logos, metrics, or star counts; none exist.
- **Don't** use a split hero over a row of equal icon cards.
