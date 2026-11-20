---
name: STL Quest
description: A kitchen expo pass for 3D-print requests, where thermal tickets ride the rail from queue to pickup.
colors:
  thermal-red: '#cf3119'
  thermal-red-night: '#ff6447'
  note-red: '#ab2713'
  ticket-note-red: '#b72a14'
  fault-red: '#a8221a'
  thermal-ink: '#17181a'
  shell-ink-night: '#0b0c0d'
  shell-bone: '#f2f1ec'
  shell-graphite: '#a9adb0'
  shell-seam: '#2a2c30'
  brushed-steel: '#dcdfdd'
  steel-plate: '#eef0ee'
  steel-recess: '#cdd1cf'
  steel-pressed: '#c3c8c6'
  steel-rule: '#b7bcba'
  steel-input: '#9fa5a3'
  rail-steel: '#8d9391'
  worn-graphite: '#4a4f53'
  popover-paper: '#f6f7f5'
  field-white: '#fbfbfa'
  ticket-paper: '#fbfaf5'
  ticket-graphite: '#575b5e'
  render-ground: '#e8e7e1'
  focus-blue: '#1f5fd1'
  night-steel: '#131517'
  night-plate: '#1b1e21'
  night-paper: '#26292d'
  night-render-ground: '#303439'
  stage-queue: '#6c7175'
  stage-up-next: '#2360c4'
  stage-printing: '#f0a40f'
  stage-finishing: '#7c4cc4'
  stage-ready: '#1f7a43'
typography:
  display:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.85rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.01em'
  headline:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.875rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '-0.025em'
  title:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '-0.01em'
  name:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 700
    lineHeight: 1.25
  zone-label:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '0.875rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '0.015em'
  docket-title:
    fontFamily: "'Oswald', system-ui, sans-serif"
    fontSize: '1.125rem'
    fontWeight: 700
    lineHeight: 1
    letterSpacing: '0.01em'
  body:
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
  label:
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace"
    fontSize: '11px'
    fontWeight: 400
    lineHeight: 1
rounded:
  cell: '2px'
  ticket: '3px'
  plate: '4px'
  md: '0.28125rem'
  lg: '0.375rem'
spacing:
  cell-gap: '3px'
  xs: '0.5rem'
  sm: '0.75rem'
  md: '1rem'
  rail-row: '2rem'
components:
  button-primary:
    backgroundColor: '{colors.thermal-red}'
    textColor: '#ffffff'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    height: '2rem'
    padding: '0 0.625rem'
  button-primary-hover:
    backgroundColor: 'color-mix(in oklch, #cf3119, #17181a 14%)'
  button-primary-disabled:
    backgroundColor: '{colors.steel-recess}'
    textColor: '{colors.worn-graphite}'
  button-outline:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.md}'
    height: '2rem'
    padding: '0 0.625rem'
  button-outline-hover:
    backgroundColor: '{colors.steel-recess}'
  button-ghost-hover:
    backgroundColor: '{colors.steel-recess}'
    textColor: '{colors.thermal-ink}'
  input:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.lg}'
    height: '2rem'
    padding: '0.25rem 0.625rem'
  app-bar:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    height: '3.25rem'
  zone-heading:
    backgroundColor: 'transparent'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.zone-label}'
    rounded: '{rounded.md}'
    padding: '0.125rem 0.25rem'
  zone-count:
    backgroundColor: '{colors.stage-up-next}'
    textColor: '#ffffff'
    typography: '{typography.label}'
    rounded: '{rounded.ticket}'
    padding: '0.125rem 0.375rem'
  settings-docket:
    backgroundColor: '{colors.steel-plate}'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.docket-title}'
    rounded: '{rounded.lg}'
    padding: '1.5rem 1.25rem 1.25rem'
  menu-item:
    backgroundColor: '{colors.popover-paper}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.md}'
    height: '1.75rem'
    padding: '0 0.5rem'
  selection-bar:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    rounded: '{rounded.lg}'
    padding: '0.375rem 0.375rem 0.375rem 0.75rem'
  stage-jump-chip:
    backgroundColor: '{colors.steel-plate}'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.zone-label}'
    rounded: '{rounded.md}'
    height: '2rem'
    padding: '0 0.625rem'
  stage-jump-chip-current:
    backgroundColor: '{colors.stage-up-next}'
    textColor: '#ffffff'
  receipt-total:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    rounded: '{rounded.lg}'
    padding: '1.25rem 1rem'
  summary-row:
    backgroundColor: '{colors.field-white}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.md}'
    padding: '0.5rem 0.75rem'
  ticket:
    backgroundColor: '{colors.ticket-paper}'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.title}'
    rounded: '{rounded.ticket}'
    padding: '1rem 0.75rem 0.75rem'
    width: '11rem'
  ticket-lead:
    backgroundColor: '{colors.ticket-paper}'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.display}'
    rounded: '{rounded.ticket}'
    padding: '1rem 0.75rem 0.75rem'
    width: '16rem'
  backlog-row:
    backgroundColor: 'transparent'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.name}'
    rounded: '{rounded.md}'
    padding: '0.5rem'
  slip:
    backgroundColor: '{colors.ticket-paper}'
    textColor: '{colors.thermal-ink}'
    typography: '{typography.name}'
    rounded: '{rounded.ticket}'
    padding: '0.5rem 0.625rem'
  station-header:
    backgroundColor: '{colors.stage-printing}'
    textColor: '{colors.thermal-ink}'
    padding: '0.5rem 0.75rem'
  station-idle:
    backgroundColor: '{colors.thermal-ink}'
    textColor: '{colors.shell-bone}'
    rounded: '{rounded.lg}'
    padding: '0.5rem 0.75rem'
  copy-cell:
    backgroundColor: '{colors.stage-printing}'
    rounded: '{rounded.cell}'
    size: '0.5rem'
  requester-plate:
    textColor: '#ffffff'
    rounded: '{rounded.plate}'
  dialog:
    backgroundColor: '{colors.popover-paper}'
    textColor: '{colors.thermal-ink}'
    rounded: '{rounded.lg}'
    padding: '1rem'
---

<!-- markdownlint-disable MD024 MD036 MD025 -->
<!-- The DESIGN.md spec requires the bolded North Star line (MD036), a "Named Rules" heading per section (MD024),
     and a `title` typography role whose key markdownlint mistakes for a front-matter document title (MD025). -->

# Design System: STL Quest

## Overview

**Creative North Star: "The Pass"**

STL Quest is a kitchen expo pass for a print shop. The board is the counter where the operator calls what fires next: requests are thermal tickets printed in black ink on paper, hung from a steel rail, and moved stage by stage until the requester collects them. The ground is brushed steel, the bar across the top is ink black, and a second thermal ink, red, marks the one thing to do now, a note the operator must read, and an age that has gone hot. Everything else is information, set in black.

Each of the five stages owns one flat colour in production order: queue graphite, up next blue, printing amber, finishing violet, ready green. A stage colour fills whole regions (a zone's count chip, a busy printer's header, the bar across a ticket's top, every copy cell) rather than tinting chips. Density is working density: the board fits a solo maker's six copies and a farm's six hundred in the same footprint by summarising whatever the operator does not act on individually.

At night the same pass runs on dark steel with tickets on charcoal paper, so a wall of them does not glare and paper-built surfaces (the request dialog, the intake drop zone, the model plate) sit in the dark board instead of shining out of it; ticket ink turns bone and every ink lifts to hold contrast. The public landing pages (`src/client/landing/`, served at `/`, `/home`, and the legal pages on the hosted service) are this same pass seen from the counter, on the same tokens in both themes; how they compose it at marketing scale is documented in `docs/landing/DESIGN.md`.

**Key Characteristics:**

- Brushed-steel ground, paper tickets, black thermal ink, red as the second ink.
- The bar and the board toolbar sit on the steel ground in both themes, divided from the work by one hairline; ink is kept for things that ask for attention (idle stations, the selection bar, the receipt total, docket and dialog edges).
- Five flat stage colours that own regions, never decorative tints.
- Oswald for headings, ticket names, and labels; IBM Plex Sans for UI and request names in lists; IBM Plex Mono for figures and ticket headers.
- Copies drawn as counted stage-coloured cells, so per-copy truth is visible without reading.
- Fixed footprints at any scale: cells folding into bands, rails and stations capped, long settings lists searchable and summarised.

## Colors

Steel neutrals and black ink carry the interface; thermal red and the five stage colours are the only saturated hues, and each has one job.

### Primary

- **Thermal Red** (`thermal-red`; `thermal-red-night` in the dark theme): the one commit action per surface (Add a print, Start printing on the lead ticket, Edit in the detail dialog, the dialog's confirm), the active navigation underline, the caret, selection on a card, and the update dot on the bar.

### Secondary

- **Note Red** (`note-red` on steel, `ticket-note-red` on paper): requester notes and an overdue age. Paper surfaces swap the variable in so the same note reads correctly on a ticket and on the ground; at night the two are the same lifted red (`#ff8a75`, 6.4:1 on charcoal paper).
- **Fault Red** (`fault-red`): destructive actions (tinted fill at 10%, solid text) and invalid fields only.

### Tertiary: the stage colours

- **Queue Graphite** (`stage-queue`), **Up Next Blue** (`stage-up-next`), **Printing Amber** (`stage-printing`), **Finishing Violet** (`stage-finishing`), **Ready Green** (`stage-ready`). Each pairs with a fixed foreground (white in light, near-black in dark; amber always takes ink). They are applied through `data-stage` on any element, which sets `--stage` and `--stage-foreground`, so a zone marker, a count chip, a ticket bar, and a copy cell share one source. Dark theme lifts each stage for contrast on night steel.

### Neutral

- **Thermal Ink** (`thermal-ink`): all text on steel and paper, and the ink accents (idle printer lines, selection bar, docket and dialog top edges). Night shell drops to `shell-ink-night`.
- **Shell Bone / Shell Graphite / Shell Seam**: primary text, secondary text, and hover or divider fill inside ink accents.
- **Brushed Steel** (`brushed-steel`): the page ground. **Steel Plate** (`steel-plate`): cards and printer stations set on the ground. **Steel Recess / Steel Pressed**: muted fills, secondary buttons, hover. **Steel Rule** (`steel-rule`): hairlines and list dividers. **Steel Input** (`steel-input`): field and outline-button strokes.
- **Rail Steel** (`rail-steel`): the rail tickets hang from and the hanger tabs on each ticket.
- **Worn Graphite** (`worn-graphite`): secondary text on steel. **Ticket Graphite** (`ticket-graphite`): secondary text on paper.
- **Ticket Paper** (`ticket-paper`; `night-paper` in dark): every ticket, job, and slip, plus the request detail dialog, the intake drop zone, and My requests rows. By day it is warm white under black ink; at night it is charcoal (`night-paper`) under bone ink (`#ecebe5`, 12.2:1) with lifted graphite secondary text (`#a2a8ad`, 6.1:1). **Popover Paper** (`popover-paper`): dialogs and popovers. **Field White** (`field-white`): inputs and outline buttons.
- **Render Ground** (`render-ground`; `night-render-ground` in dark): the plate under model thumbnails and the 3D viewer. Light by day; at night a charcoal plate one step lighter than night paper, so a grey render (`#a8a29a`) still holds 4.95:1 against it.
- **Focus Blue** (`focus-blue`): focus rings only.
- **Night Steel / Night Plate**: the dark theme's ground and card.

Two fixed sets sit outside the frontmatter and live in `src/theme.css`: twelve tag dots (rose through fuchsia, tuned to one lightness and chroma), and eight requester inks (`--requester-1` to `--requester-8`), muted blues, plums, and earths chosen to stay clear of every stage hue.

The `.on-shell` scope re-maps the surface tokens (background, card, muted, border, input, field) to dark seam values, and lifts fault red to `#ff7a68`, so standard controls set into ink (the selection bar, the calculator's receipt total) read as the night pass in either theme.

### Named Rules

**The Second Ink Rule.** Red is a thermal ink with three jobs: the one commit action, a note to act on, and an age gone hot. A surface carries at most one solid red button. Red is never decoration, a brand wash, or a stage.

**The Stage Owns the Region Rule.** A stage colour is a flat fill over a whole region (zone marker and count chip, station header, ticket bar, cell) and always comes from `data-stage`. Never invent a stage tint, gradient, or sixth hue; a hovered drop zone takes the stage at 10% with a dashed stage outline, and nothing else tints.

**The One Plate Rule.** One requester, one ink plate everywhere: avatar initials, the detail dialog's requester chip, and the ready shelf all use the same requester ink, hashed from the name unless the user picked a colour.

## Typography

**Display Font:** Oswald (with system-ui)
**Body Font:** IBM Plex Sans (with system-ui)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace)

**Character:** A condensed display face prints the ticket headlines and labels, a plain grotesque carries the UI, and its mono sibling is the receipt printer for numbers, counts, ages, and ticket headers. The root size is 18px and figures are tabular everywhere. Faces are set by role through `--face-heading`, `--face-sans`, `--face-name`, and `--face-mono` in `src/theme.css`; the `font-serif` utility is the name role, not a serif.

### Hierarchy

- **Display** (800, 1.85rem, line-height 1, uppercase): the lead ticket's request name on the up-next rail. Nothing else is this size on the board.
- **Headline** (800, 1.875rem, line-height 1, uppercase): page titles on settings and other contained pages.
- **Title** (800, 1.125rem, line-height 1.05, uppercase): ticket names on the rail. Dialog titles use the heading width at 1.25rem, uppercase, extra-bold.
- **Name** (700, 1rem, leading tight, sentence case): request names in backlog rows, printer jobs, and slips (0.95rem on slips); printer names in station headers (800).
- **Docket Title** (800, 1.125rem, line-height 1, 0.01em tracking, uppercase): the title inside each settings docket, red on a danger docket. Consumable sections carry their count here (`Resins · 9`).
- **Zone Label** (800, 0.875rem, 0.015em tracking, uppercase): zone headings and the printer groups in settings (`RESIN · 4`). Detail-row terms use the face at 0.75rem bold, and settings navigation group labels at 11px semibold, both at 0.015em.
- **Body** (400, 1rem; 0.875rem in dense controls; 0.8rem in popup menus): UI text, metadata lines, descriptions. Context-menu, select, and combobox items sit a step below body so menus do not balloon on the 18px root.
- **Label** (IBM Plex Mono, 11px, uppercase where it is a header): ticket headers (number, age), meta strips under the perforation, counts (`×8 of 16`), zone copy counts, station summaries (`RESIN · ×9`, `FILAMENT · IDLE`), and consumable key figures (`€32/L`).

### Named Rules

**The Stretch Rule.** Names are condensed and heavy; everything you operate is normal width. Never set UI controls, body copy, or descriptions in the condensed name width.

**The Tight Caps Rule.** Uppercase Oswald labels track at 0.015em (0.01em on docket titles, 0.02em on the brand and requester plates); condensed names and display sizes track slightly negative. Wide-spaced small caps are not part of this world.

**The Receipt Rule.** Numbers that describe work (counts, ages, positions, estimates, totals) are IBM Plex Mono. Prose numbers inside sentences stay in IBM Plex Sans.

## Layout

The app is a full-height column: the bar (3.25rem, steel ground with a 1px steel-rule bottom edge), then the board. On the board route the toolbar sits on the same steel beneath the bar, and the zones begin directly below it. Contained pages (settings, archive, calculator) centre at `max-w-6xl` with 1.5rem side padding.

The board is a container-query layout. At 960px of board width and up it is three zones in a grid (`minmax(14rem,17rem)` | `minmax(22rem,1fr)` | `minmax(13rem,15rem)`, 1rem gap, 0.75rem padding): the queue as a dense backlog list on the left; the centre holding the up-next rail of hanging tickets, then printing grouped into printer stations, scrolling as one column whose zone headings pin to its top until their own zone scrolls past; the right holding the finishing shelf and the ready pickup shelf grouped by requester. Below 960px the zones become lanes side by side in a horizontally scrolling track (`min(86cqw, 24rem)` each). The track snaps on the x axis (mandatory, with a 0.75rem scroll padding) and every zone is a start snap point, so a short swipe settles back to the current lane and a longer one lands on the next lane's edge. The stage jump bar above follows the lane that settles. Below `lg` the bar's destinations drop to icons so the workspace name keeps its room, and the brand never wraps. Below 640px viewport the navigation moves to a bottom bar of icon-over-label destinations with the active one marked by a red top edge, and the toolbar stays one row: search takes the remaining width, sort, filters, and tags turn icon-only, and the board presence avatars hide.

The rail hangs tickets in wrapped rows with 1rem between tickets and 2rem between rows; each ticket carries its own stretch of rail, so every wrapped row reads as one rail. Printer stations go two-up at 1300px of board width.

### Scale rules (one printer to a print farm)

Every zone is designed for both extremes. The build implements these:

- **Cells fold into bands.** A card draws one 0.5rem cell per copy, up to 24 copies; past that, the stages draw as proportional bands in a full-width 0.5rem strip. Copies the card does not hold recede to 35% opacity.
- **The rail is capped.** Six tickets hang (the first, the lead, is larger), then four compact rows under "Then N more in firing order", and the rest fold behind Show all, so the printer stations stay a fixed distance below the rail.
- **Idle printers collapse.** A printer with no jobs and nothing waiting is one ink line. A busy printer gets a stage-amber header over its jobs; an idle printer with compatible work waiting offers the next ticket inline in a dashed slot.
- **The station strip summarises the fleet.** With two or more printers, a one-line strip above the rail folds every busy printer into one amber count chip and names idle printers by width tier (1 below 1200px, 2 to 1399px, 4 above), folding the rest into a "+N idle" chip. It hides at 1400px and up when the fleet is four or fewer, since the stations are then in view.
- **Lists and shelves virtualise.** Queue, finishing, and ready render virtually; ready groups slips under one requester line.
- **Zone headings carry the load.** Each zone heading shows its live copy count in a stage-filled mono chip, so the workload reads without a separate strip. In the narrow lane layout, where most headings are off screen, the stage jump bar carries the same counts.
- **Long settings lists turn searchable.** Once a settings list reaches eight items a search field appears above it; every word typed must match one of the item's fields, so "bambu x1" finds a printer by brand and model.
- **What the workspace prints narrows choices, not pages.** Print types come from the active printers (both before there are any) unless General settings overrides them. A single type is preselected with its control hidden, catalogue pickers open on the workspace's types with Show all, and a settings section for a type the workspace neither prints nor holds anything of collapses to one muted invitation line ("Also print resin? Add resin") instead of an empty section.
- **Printers group by type.** A mixed fleet splits into Resin and Filament tables headed `RESIN · n`; a single-type fleet stays one table. Each row shows the catalogue model under the name unless the name already says it, so bay names such as "X1C · A" still reveal the machine.
- **Consumables summarise.** Each section title carries its count, and each item is a one-line summary row that expands to its fields; new or incomplete items open expanded.
- **Solo stays honest.** A single printer shows as its station line with no strip.
- **Empty zones teach their stage.** An empty zone draws a dashed 25%-ink outline in the shape of what it holds, with one line saying what lands there: a ghost lead ticket on its stretch of rail (plus, for admins with a queue, a muted arrowed line back to the queue), a slip on each shelf, a station line when there are no printers (with an outline Add printers for admins), and in the queue the add action with Invite people for admins and, on a brand-new board, the welcome title. A fleet with nothing printing keeps its idle station lines with one muted line beneath. Copy is the member's or the admin's, names only the workspace's print types, and never prompts members to set anything up. On the wide pass Finishing and Ready each hold half the right column and scroll on their own, with the lane's scrollbar gutter always reserved so a scrollbar appearing never rewraps the cards; an empty shelf shows its slot at the top of its half. Printer stations sit two to a row on a wide pass only when there are two or more; a lone printer takes the whole centre column and lays its jobs out across it. A filtered board shows the plain "No matching prints" line instead, since it is not teaching. The outlines go as soon as the zone holds a print; nothing to dismiss.

## Elevation & Depth

The pass is flat steel with paper on it. Steel surfaces carry no shadow; depth comes from material change (paper on steel, plate on ground, ink accents) and from hairline rules. Only paper and floating layers cast a shadow.

### Shadow Vocabulary

- **Paper hang** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.08), 0 10px 18px -12px rgb(0 0 0 / 0.5)`): every ticket, lead, job, and slip. A short bottom lip and a soft under-shadow, as if the paper curls off the rail.
- **Floating layer** (Tailwind `shadow-2xl` plus a 1px ring at 10% ink): dialogs and popovers, over a 10% black backdrop with a light blur.
- **Floating bar** (Tailwind `shadow-xl`, no backdrop): the selection bar, the one surface that floats over the board without blocking it.
- **Settle flash** (`box-shadow: 0 0 0 2px var(--stage)` fading to none): the first frame of a ticket landing on a new stage.
- **Selection** (2px thermal red border, 10% red fill, 4px ring at 20% red): selected cards.

### Named Rules

**The Paper Lifts Rule.** Only paper casts a shadow. Steel plates, zones, stations, and the bar are flat; never shadow a container to separate it from the ground.

## Shapes

Corners are small and mechanical. The base radius is 0.375rem (`lg`): zones, printer stations, inputs, and dialogs. Buttons use 0.28rem (`md`). Paper is cut tighter at 3px (tickets and slips, with only the top corners rounded on the stage bar). Plates are 4px: requester initials and station-strip chips; zone count chips are 3px. Copy cells and zone markers are 2px squares. Circles are reserved for the storage gauge, notification dots, and the feedback button.

A ticket is drawn from parts: a stage bar across its top (0.375rem thick, thickening to 0.625rem and turning note red when the age is hot), a rail-steel hanger tab above it on the wide pass, a mono header, the condensed name flowing around the model's thumbnail (5rem on the lead ticket, 3.5rem on the rest, the requester's plate as a badge on its corner as on rows), so a word too long to sit beside it drops below whole, and a dashed perforation rule at 20% ink before the mono meta strip. Dialogs carry a 6px ink top edge, the shell carried onto paper.

## Components

### Buttons

Plain, solid, and quick to press.

- **Shape:** gently squared (0.28rem), 2rem tall by default; 1.75rem small, 2.75rem extra large for touch-critical actions.
- **Primary:** thermal red fill, white label (ink in the dark theme), 600 weight, 0.625rem side padding, icon at 1rem. One per surface.
- **Hover / Focus:** primary darkens by mixing 14% ink in OKLCH; press nudges the button down 1px. Focus is a 3px focus-blue ring at 50%.
- **Disabled:** a primary that cannot be pressed yet (nothing to submit, or a submit in flight) gives up its red rather than fading it: a dashed 45% muted stroke around a steel-recess fill with a muted label, at full opacity, the slot the commit will print into. Every other variant drops to 50%.
- **Outline:** field-white fill, steel-input stroke, hovering to steel recess. Used for every non-commit action (Download model, Move, Sort, Filters).
- **Ghost:** no fill, hovering to steel recess. Icon-only close and overflow controls.
- **Destructive:** fault red at 10% fill with fault-red label; never solid.
- **Ticket advance:** the lead's advance is a small primary button with label and arrow, growing to fit and truncating only past the ticket's width with the full label as its tooltip; on other tickets, jobs, and slips it is an icon-only outline button in paper colours, hidden until hover on hanging tickets and backlog rows. Starting a print names the choice: with one printer of its type the button reads "Start on Core One · A" and starts there; with several it reads "Start printing" with a chevron and opens a "Start on" menu of that type's printers (the assigned one first, then idle, then busy, each with a mono state such as `ASSIGNED · IDLE` or `×3 PRINTING`). The printer picked is assigned and the step sheet states it rather than asking.

### Zone Headings

Each zone's heading is its stage's legend, count, and select-all in one. Inside the `h2` is a single button: a 2px-cornered stage marker, the uppercase zone label, and a stage-filled copy-count chip (IBM Plex Mono 11px, 3px corners, the stage foreground). The button selects every request in the stage. Hover is a 7% ink wash at 0.28rem corners, focus is a 3px focus-blue ring, and the button is disabled when the stage is empty. A muted detail line (`101 prints`, `In firing order`, `8 people to collect`) sits right-aligned on the same line.

### Tickets / Cards

One request card renders five ways by zone, all sharing the paper material.

- **Backlog row (queue):** no paper; transparent row on steel with a steel-rule divider, 3.5rem thumbnail, condensed name, meta line, mono count, notes in note red, copy cells. Hover is a 5% ink wash.
- **Ticket (up next):** paper, 3px corners, stage bar, hanger tab, mono header (`#02`, age), uppercase condensed title, perforation, mono meta strip. 9.5 to 11rem wide.
- **Lead ticket:** the first ticket on the rail, 13 to 16rem wide, display-size name, "FIRES NEXT" in its mono header, estimate badges, and the labelled primary advance in its lower right, which names the assigned printer.
- **Job (printer station):** paper with a 4rem thumbnail and an outline advance button.
- **Slip (finishing and ready):** compact paper with a 3rem thumbnail, condensed name, and mono count.
- **Drag and drop:** a dragged card drops to 40% and scales to 98.5%; a 4px stage-coloured bar marks the insertion edge (left/right on the rail, top/bottom in lists).

### Copy Cells

Signature component. Every copy of a request is one 0.5rem square in its stage colour, furthest stage first so the row fills from the finished end, 3px apart, wrapping. Copies this card holds are solid; the rest recede to 35%. Past 24 copies the cells become a proportional banded strip. When copies arrive in a stage, their cells stamp in one by one (scale from 1.8 and fade in over 320ms, 25ms stagger). The same cells appear under the stage summary on each row of the My requests popover, so a requester reads their copies the way the operator does.

### Age Stamp

IBM Plex Mono 11px at 75% opacity, in the largest whole unit that fits a few characters (`9m`, `1h`, `3d`, `2w`). At seven days the stamp turns bold note red and the ticket's stage bar becomes a thicker note-red bar.

### Printer Stations

Busy station: steel-plate container, 0.375rem corners, header in flat printing amber with the condensed printer name and a mono summary, jobs stacked beneath with 0.5rem gaps. Idle station: the header alone, in ink, as one line. An idle printer with waiting work shows "Next for this printer" and the waiting ticket in a dashed 30%-ink slot with a primary Start printing button. A station is a drop target for a single ticket of its print type: it takes a dashed stage outline while hovered, and the drop starts the print on that printer; a drop on the zone itself leaves the choice to the step sheet.

### Plates

A plate records what went on one run of a printer so the slicer's totals can be split across its prints; it is a record, not a board stage, and prints move as they always do. "Put on a plate" in the selection bar takes the selected copies, the printer they share (or one the operator picks), and an optional "other stuff that isn't in STL Quest" checkbox. A plate shows on its printer's station as one line under the header, "Plate #3 · 2 prints", with "Enter totals" and "Upload slicer file" until it is recorded and its total weight with a check after, and leaves the station once none of its prints is still printing; each print's details list its plates as "On plate #3" links. Only admins see plates, and only while usage tracking is on. The plate dialog reads a Bambu Studio or OrcaSlicer `.gcode.3mf` or plain `.gcode` in the browser and never uploads it: it lists every object with its grams and a select prefilled from the model's file name (cut and connector suffixes ignored) or "Not in STL Quest", one material per filament prefilled from the library by colour and type with "Something else" (a name and an optional price, which joins the library), the slicer's time in hours and minutes, and a live "How it splits". Typed totals take the material in mL or g by print type, the time, the material, and, when the plate has other stuff, a rough percentage that stays unattributed. Material is split by the slicer's per-object amounts, with purge and prime tower shared out by weight, or else by model volume, then print estimate, then evenly by copies; print time is always split in proportion to each print's share of the material, which is simple and close enough for one run. Resin plates take typed totals only. Recording toasts with Undo, and uploading again replaces what the plate recorded.

### Stage Jump Bar

The narrow board's index of lanes, shown only below the 960px board container. One 2rem chip per stage in a horizontally scrolling row: a 2px stage marker, the uppercase zone-label face at 0.75rem, and the mono copy count. The lane being read (the leftmost lane at least half in view) is the stage-filled chip, marked `aria-current`, with the marker dropped; the others are steel-plate chips with a steel-rule border. Tapping a chip scrolls its lane into view.

### Receipt Total

The calculator reads as three dockets: Setup (print type, printer, material, equipment) and Sliced job (the slicer's material and print time, plates, hands-on time) in the main column, and the Rough quote beside them, sticky from `lg` (on phones it sits between the two). The quote's suggested price is a receipt total: a ticket-paper panel with a 1px steel-rule border, 0.375rem corners, centred, with an 11px uppercase muted caption, the price as a 3rem extra-bold heading-face figure, one muted 0.75rem line beneath giving what it costs to make and the margin, and a ghost Copy button. Until the job has material or print time, the panel holds a muted hint and a small outline "Try a typical job" button instead of a price. The cost breakdown and the per-printer comparison fold beneath it as disclosures (a chevron that turns 90° and a muted summary line, the comparison summarised as a price range across the printers). Below them the Cost basis section lists what the picks cost per print hour, per plate, per unit of material, and per use of each piece of equipment, with a dashed "typical" tag on any rate that fell back to a stand-in, so the page says something before the slicer totals are in. A single line at the foot names the labour rate, failure allowance, and margin in use (tagged as defaults until they are saved) and links to Pricing settings. The calculator never edits rates. Selecting prints on the board and choosing Estimate price opens the same page as a list of those prints, each priced from its own estimate on its assigned printer (or its print type's defaults), with the total as the receipt.

### Link Placeholders

A print added by link has no render, so its placeholders stay neutral: the model field and the attach drop zone are the render ground with a 2px dashed border at 20 to 25% ink and a muted link glyph, and the card thumbnail shows the link glyph in ticket graphite. Hover on a drop zone turns the border thermal red.

### Requester Plates

Initials in white, extra-bold heading face, on the requester's ink, 4px corners. Used on every card, the ready shelf's requester line, the toolbar's My requests filter, and the account button.

### Summary Rows

Settings lists that grow with a farm (printers, equipment, consumables) are read-only rows in one bordered card that open a dialog for the whole item: the picture (a printer or kit photo, a filament's colour swatch, or a quiet material icon), the name in semibold with one muted line of what the catalogue says beneath, then the item's key figures in muted IBM Plex Mono at 0.75rem (stock on hand, `€32/L`, `€24/kg`), and a chevron; on a phone the figures drop under the name. Only the rows in view render, so a library of hundreds stays light. Lists that split by kind give each kind its own stacked section, titled with its count ("Resin printers · 9", "Finishing · 6"), with one search above them all; a row never repeats what its section already says, and a fleet with one print type shows only that section.

### Settings Spec Sheet

Settings pages read as a spec sheet. Each group is a line of it: on wide screens (`lg`) the group's name (heading face, 1rem bold uppercase) and its purpose (0.875rem muted, relaxed leading) sit in a 15rem margin column, beside a plain steel-plate panel of fields (1px steel-rule border, 0.375rem corners, 1rem padding, 1.25rem from `sm`); below `lg` the heading stacks above the panel. Consecutive groups are ruled off with a hairline and 2rem of space. Lists and tables that need the width (printers, consumables, members) stack their heading above a full-width panel. A group with nothing to show beyond its explanation renders no panel, an untitled group's panel still sits in the field column, and panels hug their content rather than stretching to a long explanation. Danger groups turn the heading fault red and the panel to a 5% red tint with a 40% red border; an action the workspace cannot take yet (deleting the only workspace) is a disabled outline button with a lock and its reason beside it, never a faded red one. Rows of things to set up (sign-in methods, two-factor, mail server) sit directly in the panel and rule off from the row above; their state badge is success green when on, outlined when ready, and muted when off; a toggle row (telemetry) puts its switch in the actions. Switches are ink when on. Progress bars run in ink; only work that finishes as the good outcome (background jobs) turns success green when complete, and usage meters stay ink. Fault red never marks a good state. Settings pages that do not apply to a deployment (Plan without billing) leave the navigation and redirect rather than showing a heading over nothing. The email logo sits in a white email-header preview slot beside its actions, showing the workspace name as emails do when there is no logo.

Pricing lives in settings, not the calculator: Pricing holds the business rates every quote shares (currency, electricity, labour, failure allowance, margin) and Material estimates, which turn a model's geometry into material. Material estimates show only the print types the workspace prints. Resin takes a supports and waste percentage plus a fixed amount per part, since small parts carry proportionally more support and raft (60% and 1 mL by default, measured on resin miniatures with auto-generated supports), with a live example ("A 2 mL model is estimated at 4.2 mL"). Filament takes a supports and waste percentage (25% by default, since heavily supported figures need about 50–75% and simple parts almost none) with the infill percentage and wall count from the operator's slicer profile (15% and 2), and a live example for a 20 mm cube. Percentages go up to 200%; each copy carries the whole estimate, its own supports included. They apply on every read, so changing one updates every automatic estimate on the board, in quotes, step sheets, and plate splits at once; an admin's adjusted estimate, a plate's recorded totals, and usage already recorded keep their own numbers. What a printer costs to run lives with the printer.

List pages put their one primary add action in the page header, top right (Printers, Equipment, Members, Consumables, where Add opens a menu of named actions such as Add resin); long sections also carry their own named add as a small outline button at the right of the section heading, and a group that pins what it adds (a wear-part model group) keeps its own. An add action never sits only at the bottom of a list. An empty page whose empty state carries the add action (Equipment) leaves the header without one, so the surface keeps one primary.

Long collections in settings (printers, and later parts) are read-only rows that open one dialog for the whole item: the printer row shows its picture, name, and the catalogue model beneath when the name differs; its dialog holds the catalogue model as a card (picture, name, and its print type and build volume as plain text, with Change model), a name that defaults to the model and exists to tell identical machines apart, add-on modules, and wear (purchase price and lifespan). A catalogue model's print type and size are never shown as fields, disabled or otherwise: only a custom printer gets the print-type control, build-volume inputs, and printing power, prefilled from the model it left. Catalogue products name themselves: a resin, filament, or printer picked from a catalogue takes its name from it, and a name is typed only for something the catalogue lacks. Catalogue facts read as text; only what the user owns is a field. A catalogue item shows its product as a card with what the catalogue knows as one muted line (a resin's type and density, a printer's type and size, equipment's kind, stage, and power, a wear part's model and lifespan with its basis) and Change, never as disabled fields, and keeps fields only for price, pack size, minimum stock, a rename that tells identical units apart, and what the catalogue leaves open. A catalogue knows no prices, so a price starts empty, and an item is created once nothing it needs is missing, with the dialog's status saying what is ("Needs a price to save"). The picker's custom card switches to the full set of fields, which a custom item always has. A filament's catalogue colour is picked once from the swatches, then reads as its swatch and name with a quiet Change. Equipment serves the print type its kind implies (wash and cure stations resin, dryers filament); only an oven, ultrasonic cleaner, or other kit asks. Filament colour is a swatch picker (small round swatches in a wrapping grid, the chosen one ringed, its name beside the label, a search once a product has more than 24 colours), and a small swatch marks the filament wherever it is listed. Wear parts are never ticked on: each fits every printer of its type or named catalogue models, and running costs list the parts that apply, read-only.

Costing separates what is owned from what a job used. Settings hold the owned things once (printers with their model's wear parts and bolt-on add-ons, standalone equipment by workflow stage with the supplies it uses, consumables with stock, and business rates); usage is asked at the step where it happens. Moving prints into Printing or Finishing opens the step sheet: a non-blocking panel floating at the bottom of the board in dialog style (above the selection bar when both show, raised on phones), titled "What did you use?", with one section per print or printer, prefilled from the usage log, Enter to record and Skip to record nothing, prints joining an open sheet as they move; a recorded step toasts with Undo. Stock shortfalls are a muted line with an amber caution icon, never a block — red stays reserved for faults, and the printing-stage amber doubles as the caution colour until a caution token exists. Wear-part maintenance is a thin ink bar that turns amber from 80% and red when due, with "Replaced" beside it. Catalogue pickers (printers, equipment, resins, filaments, wear parts) share one layout: a search box, the custom card first, then every group open under an uppercase heading with its count (`ELEGOO · 12`), its cards two to a row from `sm`, rendered only as they scroll into view. Catalogue cards that add something carry a trailing + (or › when they change something) and the same hover border and focus ring in every picker; one already in the library is marked, and a filament can still be added again for another colour. Calculator figures that fell back to typical values carry a small dashed-outline "typical" tag. The calculator page has Quote | Spend tabs in its header; charts use the --chart-1..3 tokens.

Usage and stock tracking is opt-in, a switch in General that is off for new workspaces. While it is off there are no step sheets, stock levels, "What you need" list, low-stock markers, maintenance bars, per-print actual cost, or spend overview; printers, equipment, consumables, and pricing stay, because quotes need them, and turning it off hides what was recorded without deleting it. It is offered where it would pay off rather than announced: a quiet, admin-only line in muted 0.875rem text (a gauge icon, what it gives in one phrase, a middle dot, then an underlined "Turn on" link that enables it in one click, and a muted "What this does" link opening a short popover explanation) sits in place of what tracking would show (the Consumables needs panel, the printer dialog's maintenance section, the Spend tab, where the explanation is spelled out because the page has nothing else), plus an optional last step in the onboarding quest. Never a modal, a banner, or a badge; members who are not admins see nothing. Once tracking is on, the Spend tab offers prints finished before it the same quiet way, "Fill in from past prints · 12 prints since May 2026", which records each from its estimate in one step that toasts with Undo; what it records carries a dashed "estimated" tag, and the total says how much of it was estimated. A plate's usage carries a dashed "from your slicer" tag instead, and the total says how much came from the slicer and how much from print estimates. An admin can record what a print was charged in its details (blank means not recorded); once a print with a charge finished in the period, Spend's tiles become Total spent, Earned, and Profit over Prints, Failed runs, and Wasted stock. A charge counts once, in the period holding the print's last live usage, against everything the print used in every period, and the Profit tile says so and what that was; a charged print with no usage never finished, so it is not counted. "By print" shows each such print's profit under its cost in the period. These are recorded numbers, not payments.

The calculator's job and quote panels keep the docket: an ink bar across the top, the title inside, and a dashed tear line.

### Selection Bar

Whenever board cards are selected, an ink bar floats at the bottom centre (on phones, left-aligned above the bottom navigation and clear of the feedback button), fading and sliding in 0.5rem from below. It is the ink shell under the `.on-shell` scope, which lifts fault red to `#ff7a68` so a destructive label stays legible on ink. It reads, left to right: the selection count in 0.875rem semibold (`101 prints · 786 copies selected`, a polite live region; below `md` only the print count, in mono), then small ghost actions (Move, Manage tags, Download, Print again, Archive, and Delete in fault red), then a ghost clear button. Each action appears only when every selected print allows it. Labels show from `lg`; below that the actions are icon-only with tighter padding, and the row scrolls horizontally rather than wrapping. Esc also clears, and clicks inside the bar never clear the selection.

### Menus

Context menus, the sort menu, selects, and comboboxes are popover paper at 0.375rem corners. Text runs at 0.8rem, a step below body; context-menu items are 1.75rem tall with 0.875rem icons, and highlighted items take the accent fill at 0.28rem corners.

### Inputs / Fields

- **Style:** field white with a 1px steel-input stroke, 0.375rem corners, 2rem tall, 0.625rem side padding; caret in thermal red.
- **Focus:** stroke turns focus blue with a 3px focus-blue ring at 50%.
- **Error / Disabled:** fault-red stroke and 20% fault-red ring; disabled drops to 50% on the field-hover fill.
- Inside ink accents, fields take the `.on-shell` seam fill and border.

### Navigation

The bar is steel ground with a hairline bottom rule, the brand mark, a divider, the workspace name in muted text, then destinations on the right: icon plus 600-weight label in muted text, turning ink on hover; the current destination is ink with a 3px thermal-red underline on the bar's lower edge. Below `lg` the labels become screen-reader only and the destinations are icons. Phone width moves destinations to a bottom steel bar with a hairline top rule with a 3px red top edge on the current one. Settings uses a left rail of links grouped by task (Workspace, Production, Connections, You, STL Quest) on desktop, the current one marked by a 3px thermal-red inner edge, and a select-style button on narrow screens. "/" focuses the board or archive search from anywhere unless the user is typing in a field (declared with `aria-keyshortcuts`).

### Sign-in Card

The sign-in, setup, invite, and password-reset card is a ticket hung on the pass (`AuthTicket`): ticket paper with 3px corners, a 6px ink top edge, a rail-steel hanger tab over its top centre, an extra-bold uppercase title, a dashed perforation between the title and the form, and an `xl` shadow at 10% black. A one-line muted tagline sits under the brand above it.

### Autosave

Settings save themselves; there is no Save button or save bar on a plain settings form. An edit is stored about 600ms after the last keystroke, at once when focus leaves the form or its dialog closes, and one save at a time, newest last. One status sits at the right of the page header (in an edit dialog, beside its title), in 0.75rem muted text: "Saving…" with the layer spinner while an edit waits or is stored, "Saved" with a check after, and "Couldn't save" in fault red followed by an underlined Retry when a save failed. Nothing shows before the first edit. A value that is invalid is never stored: its field shows the error and the last valid value stays saved. A row or item that is not complete yet (a consumable without a name, a custom printer without a name) is created once it is, and says so. A refresh from elsewhere never replaces a field while focus is in its form. Edit dialogs end with a single primary Done instead of Save and Cancel, and removing an item from a list toasts with Undo. Printers, equipment, and consumables are archived rather than deleted: they leave pickers and pricing but keep their place in history, and an Archived section at the foot of their page restores them. Explicit confirmation stays where a mistake costs more than a retype: credentials and secrets (mail server, storage connections, sign-in apps), switching or migrating storage, email and password changes, invitations, and destructive actions behind a confirm dialog.

### Dialogs

Popover paper, 0.375rem corners with a 6px ink top edge, 1rem padding, floating-layer shadow over a light blurred backdrop. On phones every dialog fills the screen, square-cornered and without the zoom; confirmations stay small and centred. Title in uppercase extra-bold heading face; footer actions right-aligned on a muted band (outline actions, then one primary). The request detail dialog is set on ticket paper instead of popover paper and pairs the model viewer on render ground with a definition list whose terms are small uppercase bold labels on steel-rule dividers.

### Motion

- **Card settle** (320ms, `cubic-bezier(0.16, 1, 0.3, 1)`): a ticket landing on a new stage drops 6px onto its rail, overshoots 1px, and its stage colour flashes as a 2px ring.
- **Cell stamp** (320ms, same ease, 25ms stagger): copy cells restamp in their new stage colour.
- **Layer rise** (0.9s ease-in-out, infinite): the spinner, bars rising like printed layers.
- Dialogs fade and scale from 95% in 150ms. Stamps respect reduced motion.

## Do's and Don'ts

### Do

- **Do** fill whole regions with a flat stage colour through `data-stage`, so marker, count chip, ticket bar, and cell agree.
- **Do** surface bulk actions on the floating ink selection bar, showing only the actions every selected print allows.
- **Do** give a narrow board a stage jump bar, since lane headings are off screen.
- **Do** keep placeholders neutral (render ground, dashed ink border, muted glyph); red is never a placeholder colour.
- **Do** keep one solid thermal-red button per surface; everything else is outline or ghost.
- **Do** put ticket and printer names in Oswald and every count, age, and position in IBM Plex Mono.
- **Do** show copies as stage-coloured cells and switch to bands past 24.
- **Do** design each zone for one printer and for a farm: cap rails, fold cells into bands, collapse idle lines, summarise what the operator does not act on individually.
- **Do** lay settings out as a spec sheet: the group's name and purpose in the margin, its fields in a plain panel, groups ruled off; reserve the red group for danger.
- **Do** give a settings list a search field once it reaches eight items, and summarise each item on one line before its fields.
- **Do** put a list page's primary add action in the page header, top right, and a long section's named add in its heading; never only at the bottom of a list.
- **Do** let settings save themselves, with one Saving… / Saved / Couldn't save · Retry status in the page header, and end edit dialogs with Done; keep explicit confirmation for credentials, storage switches, email and password changes, invites, and destructive actions.
- **Do** set controls inside ink accents under `.on-shell` so they read correctly in both themes.
- **Do** set model renders on the render ground, never directly on paper or steel, and check a grey render holds at least 4.5:1 on it in both themes.

### Don't

- **Don't** use red for anything but the commit action, a note, an overdue age, or a destructive state.
- **Don't** add a sixth stage hue, tint stages into pastels, or use stage colours decoratively.
- **Don't** shadow steel: zones, stations, the bar, and plates stay flat; only paper and floating layers lift.
- **Don't** render five equal lanes of identical cards with a quantity chip; each stage has its own layout (list, rail, stations, shelf).
- **Don't** let a large fleet or queue grow a zone without bound; cap it, fold it, or virtualise it.
- **Don't** give a requester a second colour: the requester ink is their only identity colour.
- **Don't** give the landing pages tokens of their own; they compose this system, and their layout rules live in `docs/landing/DESIGN.md`.
