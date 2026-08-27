---
name: STL Quest
description: A shop-floor traveler card system for 3D-print requests moving through production.
colors:
  shop-floor: '#15171c'
  bench: '#1b1e24'
  ticket: '#262a33'
  recess: '#23262e'
  raised: '#2c303a'
  scribe-line: '#2b2f38'
  bone: '#e8e4d8'
  graphite: '#92978f'
  signal-amber: '#e89a3c'
  blueprint-teal: '#4fa8b8'
  blueprint-ink: '#0d2226'
  cure-green: '#6fae6a'
  bench-brass: '#c9a227'
  fault-red: '#cc3131'
typography:
  display:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: '0.03em'
  headline:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 'normal'
  title:
    fontFamily: 'Zilla Slab, ui-serif, serif'
    fontSize: '1rem'
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: 'normal'
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  label:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    lineHeight: 1
    letterSpacing: '0.08em'
  figure:
    fontFamily: 'IBM Plex Mono, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 'normal'
  micro:
    fontFamily: 'IBM Plex Mono, monospace'
    fontSize: '10px'
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 'normal'
rounded:
  sm: '2.4px'
  md: '3.2px'
  lg: '4px'
  xl: '5.6px'
  pill: '10.4px'
spacing:
  hair: '4.5px'
  tight: '9px'
  snug: '13.5px'
  base: '18px'
  loose: '27px'
components:
  button-primary:
    backgroundColor: '{colors.signal-amber}'
    textColor: '{colors.shop-floor}'
    rounded: '{rounded.lg}'
    padding: '0 11.25px'
    height: '36px'
    typography: '{typography.body}'
  button-primary-hover:
    backgroundColor: '#eda85a'
    textColor: '{colors.shop-floor}'
  button-outline:
    backgroundColor: '{colors.shop-floor}'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '0 11.25px'
    height: '36px'
  button-outline-hover:
    backgroundColor: '{colors.recess}'
    textColor: '{colors.bone}'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    height: '36px'
  traveler-card:
    backgroundColor: '{colors.ticket}'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '11.25px'
  traveler-card-selected:
    backgroundColor: '#3a3630'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
  stage-label:
    backgroundColor: 'transparent'
    textColor: '{colors.bone}'
    typography: '{typography.label}'
  copy-count:
    backgroundColor: '{colors.recess}'
    textColor: '{colors.graphite}'
    rounded: '{rounded.sm}'
    padding: '2.25px 6.75px'
    typography: '{typography.figure}'
  input-field:
    backgroundColor: 'rgb(0 0 0 / 0.1)'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '4.5px 11.25px'
    height: '36px'
  badge-default:
    backgroundColor: '{colors.signal-amber}'
    textColor: '{colors.shop-floor}'
    rounded: '{rounded.pill}'
    padding: '2.25px 9px'
    height: '22.5px'
  card-surface:
    backgroundColor: '{colors.bench}'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '18px'
---

<!-- markdownlint-disable MD024 MD036 MD025 -->
<!-- The DESIGN.md spec requires the bolded North Star line (MD036), a "Named Rules" heading per section (MD024),
     and a `title` typography role whose key markdownlint mistakes for a front-matter document title (MD025). -->

# Design System: STL Quest

## Overview

**Creative North Star: "The Shop Floor Traveler"**

A traveler is the card that rides along with a job through a workshop: it carries the part's name, its quantity, whose it is, and which machine it is on, and it gets stamped as it crosses each station. STL Quest is that system rendered in software. The board is the floor, the five columns are stations, and every card is a physical thing being handed forward. Nothing here is decorative for its own sake — the drafting language exists because this is a room where things are measured, and the paper language exists because a work order is a record.

The room is dark and cool, the colour of a workshop lit for screens rather than daylight. Against it, everything the operator reads is warm bone-white on a slightly raised ticket, and the only saturated colour in the interface is a single amber that means _this is where a decision lives_. Blueprint teal is not a second brand colour; it is linework. It draws the rules that separate the rail from the board and the board header from the lanes, it fills the graph-paper behind a model thumbnail, and it marks where a dragged card will land. Structure is teal. Decisions are amber. Everything else is grey.

Density is deliberately high and the type is deliberately small against an 18px root, because an operator is reading fourteen jobs at once, not one. The system earns its legibility through hierarchy rather than air: condensed uppercase for stations, a slab serif for the one thing on a card that is a proper noun, and monospace for every figure the eye needs to compare down a column. It is not minimal — it is dense and intentional, which is a different thing.

**Key Characteristics:**

- Tonal layering, not shadow: five stops from floor to raised, hairline rings, almost no elevation.
- Dashed blueprint rules as the only structural divider in the app shell.
- Four typefaces with four non-overlapping jobs: Oswald stations, Zilla Slab names, Plex Sans prose, Plex Mono figures.
- One saturated accent, used sparingly enough that it always means something.
- A near-square 4px corner everywhere except pills — the geometry of cut stock, not soft UI.
- Every stage owns a colour, and those five colours read as a progression.

## Colors

A cool near-black room, five tonal steps of grey-blue, warm bone text, and exactly two chromatic voices: amber for decisions, teal for structure.

### Primary

- **Signal Amber** (`{colors.signal-amber}`): The only saturated colour that appears on ordinary screens. It carries the primary button, the focus ring, the active nav item, the `Printing` stage, storage meters in a healthy state, and the selected state of a traveler card. It is never used for a surface larger than a button, and never for decoration.

### Secondary

- **Blueprint Teal** (`{colors.blueprint-teal}`): Linework, not brand. It draws the dashed rule under the board header and beside the app rail, the graph-paper grid behind model thumbnails, the drop-edge indicator while dragging, the drop-target outline on a lane, and the `Up next` stage dot. If a teal element is not describing structure or position, it is misused.
- **Blueprint Ink** (`{colors.blueprint-ink}`): The near-black teal used as foreground on a solid teal fill. It exists only for that pairing.

### Tertiary

- **Cure Green** (`{colors.cure-green}`): The `Ready` stage. The end of the line.
- **Bench Brass** (`{colors.bench-brass}`): The `Finishing` stage. Sits deliberately between amber and green so the five stage dots read as a progression rather than a set.
- **Fault Red** (`{colors.fault-red}`): Destructive actions and failure states only. It appears as a 10–20% tint behind red text far more often than as a solid fill, so a delete button reads as available but not alarming until it is hovered.

### Neutral

- **Shop Floor** (`{colors.shop-floor}`): The page. The darkest stop; everything else sits on it.
- **Bench** (`{colors.bench}`): Cards, popovers, dialogs, and the app rail. One step up from the floor.
- **Recess** (`{colors.recess}`): Muted and secondary fills — count chips, secondary buttons, progress tracks. Reads as slightly _inset_ rather than raised.
- **Ticket** (`{colors.ticket}`): The traveler card surface, and the lightest large surface in the app. A card is the thing the operator touches, so it is the thing that comes forward.
- **Raised** (`{colors.raised}`): Hover and accent fills sitting above the ticket.
- **Scribe Line** (`{colors.scribe-line}`): Borders and input strokes. Visible, never assertive.
- **Bone** (`{colors.bone}`): All primary text. Warm off-white, never pure white — pure white on this floor is glare.
- **Graphite** (`{colors.graphite}`): Secondary text, metadata rows, placeholder text, and the `Queue` stage dot. The muted voice.

### Generated Palettes

Two colours in the product are chosen by data rather than by hand, and both are constrained so they cannot collide with the meanings above.

- **Requester ink** (`src/client/requester.ts`): eight cool inks from slate blue through dusty rose, hashed from the requester's name and used for both the card avatar and the detail chip, so one person is one colour everywhere. The band is deliberately cool and deliberately narrow — people are ink, stages are warm signal — so a generated colour can never be mistaken for a stage dot or blueprint linework. Every entry clears 5.3:1 on the floor, card, and ticket surfaces. Eight inks over an unbounded member list will collide; that is accepted, because the initials carry the identity and the ink only groups the eye.
- **Tag dots** (`--tag-*` in `src/styles.css`): the twelve hue names a user can pick, each tuned to one lightness and chroma (OKLCH 0.72 / 0.11) so twelve tags read as one set. The names keep their ordinary meaning — a user who picks `amber` gets amber — but never at stock-palette saturation.

### Named Rules

**The One Voice Rule.** Signal Amber marks the single most actionable thing in view and nothing else. If two ambers compete on one screen, one of them is wrong — a mode toggle, a segmented control, and a selected tab are all structure, and take a Recess fill.

**The Generated Colour Rule.** Any colour derived from data comes from a fixed, curated list, never from a hue wheel. A full-spectrum hash will eventually produce the stage colours and the blueprint teal, and the day it does, the colour system stops meaning anything.

**The Teal Is Structure Rule.** Blueprint Teal describes where things are and where they are going — rules, grids, drop edges, position. It never fills a button, never carries a label, and never appears as a decorative wash.

**The Stage Spectrum Rule.** The five stage colours are ordered — graphite, teal, amber, brass, green — and that order is the production sequence. Never reassign a stage colour, and never introduce a sixth that breaks the ramp.

## Typography

**Display Font:** Oswald (with `system-ui, sans-serif`)
**Body Font:** IBM Plex Sans (with `system-ui, sans-serif`)
**Serif Font:** Zilla Slab (with `ui-serif, serif`)
**Mono Font:** IBM Plex Mono (with `monospace`)

**Character:** Four families, four jobs, no overlap. Oswald is condensed and vertical — it does stations, brand, and headings, and its narrowness is what lets a five-column header survive at 320px. Zilla Slab is a slab serif with workshop-signage weight; it is reserved almost entirely for the name of a print, which makes a request name read as a proper noun rather than a data field. IBM Plex Sans carries everything a person reads in sentences. IBM Plex Mono carries every figure a person compares — copy counts, byte sizes, dimensions, IDs — so numbers line up down a column.

The root is 18px, not 16px. Every rem in the system is 12.5% larger than a default Tailwind scale would suggest; `text-sm` is 15.75px, not 14px. This is what makes a dense board legible without zooming.

### Hierarchy

- **Display** (Oswald 500, 24px/1.2, +0.03em, uppercase): The brand lockup. Appears in the app rail, on the auth screen at 3rem, and nowhere else.
- **Headline** (Oswald 600, 22.5px/1.3): Page and pane headings — the archive title, dialog-level section heads.
- **Title** (Zilla Slab 600, 18px/1.375): A print's name on its traveler card, clamped to two lines. The single most important string in the product.
- **Body** (IBM Plex Sans 400, 15.75px/1.5): Prose, form labels, dialog copy, descriptions. Measure is set by the container rather than a cap; a settings description running the width of its pane is intended.
- **Label** (Oswald 600, 13.5px/1, +0.08em, uppercase): Station names in the board header, and the small stamped headings on popovers. The tracking is load-bearing — condensed uppercase without it becomes a solid block.
- **Figure** (IBM Plex Mono 400, 13.5px/1): Copy counts, totals, byte sizes, print dimensions. Anything numeric that appears more than once in a column.
- **Micro** (IBM Plex Mono 400, 10–11px/1): The floor of the ramp, and a deliberate one. Reserved for marks that sit _inside_ another element and must not compete with it — the station total chip, the `stl` thumbnail placeholder, the `+n` tag overflow counter, the storage figure in the rail. Never used for anything a person has to read as language.

### Named Rules

**The Proper Noun Rule.** Zilla Slab is for the name of a thing a person asked for — a print's name. It is not a general heading face. Using it on a section header dilutes the one signal that tells an operator "this is the job".

**The Figures Align Rule.** Any number an operator compares vertically is set in IBM Plex Mono. A count in the body sans is a bug, not a style choice.

**The Tracking Rule.** Oswald uppercase never ships below +0.08em at label sizes, or +0.03em at display sizes.

## Layout

The shell is a fixed 56px app rail on the left, dashed-ruled on its right edge, and a board that fills the rest. The board is a container-query context: a header line of station buttons, a dashed 2px rule beneath it, then a CSS grid of lanes using `grid-flow-col` with `auto-cols-[minmax(320px,1fr)]` and a 27px gutter. Lanes never collapse below 320px; below a 900px container the lanes switch to `82cqw` so the next station is always partly visible and the board reads as horizontally scrollable without a scrollbar hint.

Each lane scrolls independently and is virtualized, with cards separated by a 13.5px gap. Rhythm across the app comes from a base spacing step of 18px (`--card-spacing`), halved to 13.5px in compact cards. Dialog and pane padding follows the same step.

Density is the default and should stay that way: this is a surface where an operator wants more jobs on screen, not more air between them. Add breathing room by removing elements, not by inflating gaps.

### Named Rules

**The Peeking Lane Rule.** On narrow viewports a lane occupies 82% of the container width, never 100%. The sliver of the next station is what tells a person the board continues.

**The 320 Floor Rule.** Every surface stays usable at a 320px viewport. A lane that cannot hold a traveler card at 320px is a broken lane.

## Elevation & Depth

Surfaces that live in the layout are flat and convey depth through tonal layering; only surfaces that genuinely float get blur. Depth reads as a five-stop ramp from the floor upward — Shop Floor → Bench → Recess → Ticket → Raised — reinforced by hairline rings rather than shadow. Panels and cards use a `ring-1` at 10% of the foreground colour, which on this dark floor reads as a scribed edge rather than a border.

There are three tiers, and which one a component gets is decided by how it sits in the page, not by how important it is.

### Shadow Vocabulary

- **In-layout** (no shadow): Anything with a place in the document flow — panels, sections, rows, fields, buttons. Depth comes from the surface token and a hairline ring.
- **Ticket lift** (`0 1px 2px rgb(0 0 0 / 0.25)`): The one resting shadow, on traveler cards only, so a card reads as a physical thing lying on the lane rather than a region of it.
- **Overlay** (`shadow-md`): Popovers, menus, selects, and context menus — surfaces the user summoned that must detach from whatever they cover.
- **Floating** (`shadow-lg` / `shadow-xl`): The small set of fixed controls that hover over scrolling content — the quest launcher and its prompt card, update notices, the impersonation banner. This tier is capped at those; a component that scrolls with the page never qualifies.
- **Settle** (`0 0 0 1px var(--blueprint)` → `none`, over 240ms): Not elevation — a momentary blueprint ring fired by the `card-settle` animation when a card lands in a new station.

### Named Rules

**The Position Decides Rule.** A shadow is earned by floating, not by mattering. If a component sits in the layout, it expresses depth by choosing a lighter surface token; if it is `fixed` or summoned over other content, it takes the matching overlay or floating tier.

## Shapes

The corner language is nearly square: a 4px base radius, scaled down for small controls (3.2px on `sm`, 2.4px on the smallest chips) and up only to 10.4px, which on a 22px-tall badge reads as a pill. Nothing in the system is soft. The intent is cut stock and stamped card, not rounded app furniture.

Borders come in three forms, and the distinction is meaningful. A **hairline ring** (`ring-1` at 10% foreground) scribes a panel edge. A **solid 1px stroke** in Scribe Line marks an interactive boundary — input fields, outline buttons. A **dashed rule** in Blueprint Teal is the app's structural signature: it separates a region from what it governs, and never divides peers. It runs down the right edge of the app rail and the settings sub-nav, under the board's station header, under a dialog's title, under a settings pane's header, and around a dropzone waiting for a file. Blueprint linework is drawn at 25–40% opacity; a solid teal border is off-system. Traveler cards carry a transparent 2px border at rest that becomes Signal Amber when selected, so selection changes colour without shifting layout by a pixel.

Model thumbnails are 56px squares filled with the blueprint graph-paper grid (`--grid`, 24px ruling at 7% teal, rendered at 12px on a card) behind a 1px ticket-foreground edge at 15%.

### Named Rules

**The Dashed Rule Rule.** A dashed blueprint rule separates a region from the content it governs — rail from board, title from body, header from panes, dropzone from its dialog. It never separates two peers; that is what spacing and Scribe Line are for. Never draw it solid.

**The No-Shift Selection Rule.** Selected and unselected states must occupy identical space. Reserve the border at rest and change only its colour.

## Components

### Buttons

- **Shape:** Near-square (4px), dropping to 3.2px at `sm` and 2.4px at `xs`.
- **Sizes:** 36px default height, with 27px / 31.5px / 40.5px variants and square icon equivalents. Icons are 18px, 15.75px at `sm`.
- **Primary:** Signal Amber fill, Shop Floor text, hover at 80% opacity of the fill.
- **Outline:** Scribe Line stroke on the floor colour, hovering to Recess. This is the workhorse — it carries the traveler card itself.
- **Secondary / Ghost:** Recess fill / transparent, both hovering to a lighter tonal stop.
- **Destructive:** A 10% Fault Red tint behind Fault Red text, deepening to 20% on hover. Never a solid red fill.
- **Focus:** A 3px ring at 50% of Signal Amber plus a border shift to the ring colour. Never suppress it.
- **Active:** A 1px downward translate — the only press affordance in the system, and it is enough.

### Cards / Containers

- **Corner Style:** 4px.
- **Background:** Bench, with a `ring-1` at 10% foreground rather than a border.
- **Internal Padding:** 18px, dropping to 13.5px at `size="sm"`, exposed as `--card-spacing` so headers, content, and footers stay locked to one step.
- **Titles:** Oswald 500 at 18px — the one place Oswald is used at body scale.
- **Footers:** Recess at 50% with a top border, flush to the card edge.

### Inputs / Fields

- **Style:** 36px tall, 4px corner, Scribe Line stroke, filled with black at 10% so a field reads as cut into the surface rather than laid on it.
- **Focus:** Border shifts to Signal Amber with a 3px amber ring at 50%.
- **Error:** Border and ring shift to Fault Red, driven by `aria-invalid` rather than a class, so the visual state and the accessible state cannot drift apart.
- **Disabled:** Black at 15% with 50% opacity and no pointer events.

### Chips

- **Copy count** (Recess fill, Graphite mono text, 2.4px corner): The small figure at the end of a station header and on card metadata. Always mono, always right-aligned in its row.
- **Badge** (10.4px corner, 22.5px tall, Plex Sans 500 at 13.5px): Status and tag markers, in solid, secondary, tinted-destructive, and outline forms.

### Navigation

- **App rail:** 56px wide, Bench, dashed Blueprint Teal 2px right edge. The brand mark sits at the top; nav items are 36px circular targets that move from Graphite to Bone on hover with a Recess fill, and to Signal Amber when current. Current state is carried by `aria-current="page"`, not colour alone.
- **Station header:** A row of buttons, one per station, each a full-width Oswald uppercase label with a leading stage dot and a trailing mono total. The whole header is a button — clicking a station selects everything in it — and it disables when the station is empty.

### Traveler Card (signature component)

The one component that defines the system. A 4px Ticket-surfaced card with a single 1px shadow, an 11.25px pad, and a transparent 2px border held in reserve for selection.

- **Left:** A 56px model thumbnail, stretched to the text block's height and capped square, filled with blueprint graph paper when no render exists. A linked-source request shows a chain glyph in Signal Amber instead; a file with no thumbnail yet shows a lowercase mono `stl`.
- **Right:** The print's name in Zilla Slab 600, clamped to two lines; then a metadata row in 13.5px Graphite carrying printer or print type on the left and a mono copy count pushed right; then optional notes clamped to two lines.
- **Requester:** A small avatar inline with the name, present only when the board is showing requesters. Without a Gravatar it falls back to initials in Oswald on a 15% amber tint; a generated third-party identicon is never shown.
- **Narrow lanes (≤620px):** The thumbnail drops to 44px, the requester avatar is dropped, the name is allowed a third line, and the metadata row wraps instead of truncating. The name is the last thing on the card to lose space.
- **Drag:** The card scales to 0.985 at 40% opacity while dragging; a 2px Blueprint Teal bar rides the closest edge of its neighbour to show where it will land.
- **Selected:** Border to Signal Amber, surface to a 15% amber tint, plus a 4px amber ring at 25%.
- **Settle:** On landing in a new station, a 240ms `card-settle` — a 3px drop with a blueprint ring that fades to nothing.

## Do's and Don'ts

### Do

- **Do** express elevation by choosing a lighter surface token (Shop Floor → Bench → Recess → Ticket → Raised) rather than adding a shadow.
- **Do** set every comparable figure — counts, sizes, dimensions — in IBM Plex Mono.
- **Do** reserve Zilla Slab for the name of a requested print.
- **Do** keep Signal Amber to the single most actionable element in view.
- **Do** hold the 3px focus ring on every interactive element, including cards and station headers.
- **Do** reserve selection borders at rest so state changes never shift layout.
- **Do** design at 320px first for anything that lives in a lane.
- **Do** pair `aria-current`, `aria-pressed`, or `aria-invalid` with any colour-only state change.
- **Do** draw a colour derived from data (requester, tag, avatar) from a curated list, never from a hue wheel.
- **Do** give a destructive region the Fault Red frame and stamp rather than the default blueprint one.

### Don't

- **Don't** use Blueprint Teal as a fill, a button colour, or a text colour on ordinary UI. It is linework.
- **Don't** add a dashed border anywhere except the app rail edge and the board header rule.
- **Don't** introduce a radius above 10.4px, or a fully rounded surface larger than a badge.
- **Don't** use pure white for text; Bone is the ceiling.
- **Don't** add a second resting shadow to the system.
- **Don't** loosen board density to create breathing room — remove elements instead.
- **Don't** reassign a stage colour or break the graphite → teal → amber → brass → green progression.
- **Don't** set a count, byte size, or dimension in the body sans.
- **Don't** give a shadow to anything that scrolls with the page.
- **Don't** hand a mode toggle, segmented control, or selected tab the Signal Amber fill; that fill belongs to the action that commits.
- **Don't** let a third-party service generate an image the palette cannot control — prefer the in-system fallback.
- **Don't** truncate a print's name to gain room for anything else on its card.
