---
name: STL Quest website
description: The landing surface for STL Quest, built from the application's own palette and type.
colors:
  shop-floor: '#15171c'
  bench: '#1b1e24'
  recess: '#23262e'
  raised: '#2c303a'
  scribe-line: '#2b2f38'
  bone: '#e8e4d8'
  graphite: '#92978f'
  signal-amber: '#e89a3c'
  blueprint-teal: '#4fa8b8'
  cure-green: '#5cb86b'
  fault-red: '#cc3131'
typography:
  display:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: 'clamp(2.5rem, 6vw, 70px)'
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: '-0.02em'
  headline:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: '1.875rem'
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 'normal'
  title:
    fontFamily: 'Oswald, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: '0.025em'
  body:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  lede:
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif'
    fontSize: '1.25rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  figure:
    fontFamily: 'IBM Plex Mono, monospace'
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 'normal'
rounded:
  sm: '2.4px'
  md: '3.2px'
  lg: '4px'
  xl: '5.6px'
spacing:
  hair: '4.5px'
  tight: '9px'
  base: '18px'
  section: '45px'
components:
  button-primary:
    backgroundColor: '{colors.signal-amber}'
    textColor: '{colors.shop-floor}'
    rounded: '{rounded.lg}'
    padding: '0 18px'
    height: '49.5px'
  button-primary-hover:
    backgroundColor: '#eda85a'
    textColor: '{colors.shop-floor}'
  button-outline:
    backgroundColor: '{colors.shop-floor}'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '0 18px'
    height: '49.5px'
  card-surface:
    backgroundColor: '{colors.bench}'
    textColor: '{colors.bone}'
    rounded: '{rounded.lg}'
    padding: '22.5px'
  capability-mark:
    backgroundColor: '{colors.recess}'
    textColor: '{colors.graphite}'
    rounded: '{rounded.xl}'
    size: '31.5px'
  provider-chip:
    backgroundColor: '{colors.bench}'
    textColor: '{colors.graphite}'
    rounded: '{rounded.sm}'
    padding: '4.5px 9px'
    typography: '{typography.figure}'
---

<!-- markdownlint-disable MD024 MD036 MD025 -->
<!-- The DESIGN.md spec requires the bolded North Star line (MD036), a "Named Rules" heading per section (MD024),
     and a `title` typography role whose key markdownlint mistakes for a front-matter document title (MD025). -->

# Design System: STL Quest website

## Overview

**Creative North Star: "The Shop Floor Traveler, seen from the door"**

The application is a workshop: a dark floor, travelling cards, blueprint linework, one amber that means _act here_. This site is that same room viewed from the entrance. It borrows the application's palette, type, and corner language exactly, and adds nothing of its own, because a visitor who signs up should recognise the product they were shown.

What the site does differently is scale and pace. The application is dense because an operator reads fourteen jobs at once; the landing page is open because a stranger reads one idea at a time. So the same tokens are spent on fewer, larger elements: a 70px Oswald headline where the app uses 24px, a 1040px measure with real air between sections, and one screenshot doing the work of a paragraph. Density is not the signature here. Restraint is.

The page is an argument in four moves: what this is, watch it work, what happens to your files, and how to run it. Nothing decorative sits between those moves. The one piece of ornament in the whole site is the dashed blueprint rule under the masthead, and it earns its place by being the same rule the application draws beside its app rail.

**Key Characteristics:**

- The application's palette and type, unchanged, at landing-page scale.
- Tonal layering over shadow; a card is a lighter surface with a hairline ring.
- One accent, spent on the single action the page most wants.
- A near-square 4px corner everywhere.
- Colour is used to teach the workflow, never to decorate a list.
- Real product imagery instead of illustration.

## Colors

The application's palette, shared from `src/theme.css` rather than copied. Two of its colours do real work here; the rest are surface and text.

### Primary

- **Signal Amber** (`{colors.signal-amber}`): The action the page is arguing for, plus the `Printing` stage in the capability row. Above the fold it appears exactly once. A second amber in the same view means one of them is wrong.

### Secondary

- **Blueprint Teal** (`{colors.blueprint-teal}`): Linework and the `Up next` stage. On this site it appears in exactly two roles: the dashed rule under the masthead, and one capability mark. It never fills a button and never carries body text.

### Tertiary

- **Cure Green** (`{colors.cure-green}`): The `Ready` stage in the capability row, and the confirmation tick when the Docker command is copied. Both mean the same thing: this finished.
- **Fault Red** (`{colors.fault-red}`): Only the failure state of that same copy button.

### Neutral

- **Shop Floor** (`{colors.shop-floor}`): The page.
- **Bench** (`{colors.bench}`): Cards, provider chips, and the mobile navigation sheet.
- **Recess** (`{colors.recess}`): Capability and card marks, and the hover fill on ghost controls.
- **Scribe Line** (`{colors.scribe-line}`): Section rules, card outlines, chip borders.
- **Bone** (`{colors.bone}`): Headings and any text the visitor must not miss.
- **Graphite** (`{colors.graphite}`): Body copy, the figure caption, the footer, and the `Queue` stage. The muted voice, and the one most of the page is written in.

### Named Rules

**The One Voice Rule.** Signal Amber marks the single action the page most wants and nothing else. The masthead's call to action is deliberately an outline button so the hero owns the only accent above the fold.

**The Stage Spectrum Rule.** The four capability marks are coloured graphite, teal, amber, green, in that order, because that is the order a request moves through the board: queue, up next, printing, ready. The colour is teaching the workflow, so it may not be reordered or reassigned for visual balance.

**The No Decorative Hue Rule.** A colour appears on this page only when it means something. A list of storage providers is a list, not a spectrum: those chips are uniform, because nothing distinguishes Dropbox from Box that a colour could honestly encode.

## Typography

**Display Font:** Oswald (with `system-ui, sans-serif`)
**Body Font:** IBM Plex Sans (with `system-ui, sans-serif`)
**Mono Font:** IBM Plex Mono (with `monospace`)

**Character:** Three families, three jobs. Oswald is condensed and vertical, and at 70px it is the page's whole personality: a workshop sign, not a startup headline. IBM Plex Sans carries every sentence. IBM Plex Mono carries the things a machine would say — the Docker command, the storage provider names, the figure caption, the footer — which is what makes the page read as written by someone who runs servers.

The application's serif (Zilla Slab) is deliberately absent. It exists there to make a print's name read as a proper noun, and this site never shows one.

The root is 18px, matching the application, so every rem here is 12.5% larger than a default Tailwind scale suggests.

### Hierarchy

- **Display** (Oswald 500, 70px/1.04, tight tracking): The single page headline. One per page, never repeated in a section.
- **Headline** (Oswald 500, 33.75px): Section titles, set in the left rail rather than above the content.
- **Title** (Oswald 500, 22.5px, +0.025em): Card titles and capability names.
- **Lede** (IBM Plex Sans 400, 22.5px): The one paragraph under the headline and the opening line of a section. Capped at `max-w-xl` so it never runs the full 1040px.
- **Body** (IBM Plex Sans 400, 18px/1.5): Every other sentence.
- **Figure** (IBM Plex Mono 400, 13.5px): The Docker command, provider chips, the tour caption, the footer.

### Named Rules

**The One Headline Rule.** Display size appears once per page. A section that wants it is competing with the argument, not supporting it.

**The Machine Voice Rule.** Monospace is for what a machine would print or accept: commands, service names, the mechanical caption under the tour. It is never used to make prose look technical.

## Layout

A single 1040px column, `w-[min(1040px,calc(100%-48px))]`, holding every band from masthead to footer, so the page has one left edge the eye can follow the whole way down.

Above 821px each section becomes a two-track grid, `[210px_1fr]`, with the section heading parked in the left rail beside its content rather than stacked above it. This is the site's one structural idea and it is what keeps a four-section page from reading as four stacked slabs. Below 821px the rail collapses and headings sit above their content.

Sections are separated by a solid 1px rule in Scribe Line and 45px of vertical space. Cards sit on an asymmetric two-column grid, `[1.3fr_1fr]`, with the wider track holding the Docker command, which sets the minimum width the whole layout has to respect. That grid only engages at 1088px, below which the command would not fit a half-width card.

### Named Rules

**The One Column Rule.** Every band shares the same 1040px measure and the same 24px gutter. Nothing breaks the column except the product tour, which is allowed to run wider because it is the evidence.

**The Rail Rule.** A section heading belongs in the left rail on wide viewports. It is a label on the band, not a title above it.

## Elevation & Depth

Flat. Depth is four tonal steps from Shop Floor to Raised, plus a `ring-1` at 10% of the foreground colour to scribe a card's edge. There is no resting shadow anywhere on the page.

### Shadow Vocabulary

- **In-layout** (no shadow): Everything in the document flow, including all four run-it cards.
- **Overlay** (`shadow-xl`): The mobile navigation sheet only, which floats over the page and needs to detach from it.

### Named Rules

**The Position Decides Rule.** A shadow is earned by floating, not by mattering. The only element on this site that floats is the mobile navigation.

## Shapes

A 4px base radius, scaled down to 2.4px on chips and up to 5.6px on the small circular marks, which at 31.5px read as full circles. Nothing is soft: the intent is cut stock, matching the application.

Borders come in two weights. A **solid 1px rule** in Scribe Line separates peers — section from section, capability from capability, and the outline of a card. A **dashed 2px rule** in Blueprint Teal at 25% appears exactly once, under the masthead, where it separates the site chrome from the page it governs. That is the same job it does in the application beside the app rail and under the board header.

### Named Rules

**The Dashed Rule Rule.** The dashed blueprint rule separates a region from the content it governs, never two peers. On this site there is one such boundary and therefore one dashed rule. A second would make the first meaningless.

## Components

### Buttons

- **Shape:** Near-square (4px). Large size is 49.5px tall with 18px of horizontal padding.
- **Primary:** Signal Amber fill, Shop Floor text, hovering to 80% opacity.
- **Outline:** Scribe Line stroke on the page colour, hovering to Recess. Carries the masthead call to action and every secondary path.
- **Focus:** A 3px ring at 50% of Signal Amber. Never suppressed.
- **Active:** A 1px downward translate, the page's only press affordance.
- Links that look like buttons use `ButtonLink`, a styled anchor, because the Base UI button forces button semantics onto whatever it renders.

### Cards

- **Corner Style:** 4px, on Bench, with a `ring-1` at 10% foreground instead of a border.
- **Internal Padding:** 22.5px.
- **Header:** A 31.5px circular mark in Recess beside an Oswald title. The mark is uniform across all four run-it cards; the amber inside a card belongs to its action, not its icon.

### Chips

- **Provider chip:** Bench fill, Scribe Line border, Graphite mono text, 2.4px corner. Uniform across all seven providers.

### Capability Mark

A 31.5px circle carrying a 15.75px icon, tinted at 10% of its own colour. The four marks run graphite, teal, amber, green in board order. This is the only place on the site where colour varies across a set, and it varies because the sequence is the point.

### Product Tour (signature component)

The page's central evidence: a real recording of the application in a frame with browser-chrome dots, an expand control, and a play/pause control. It autoplays muted and looped, but only after checking `prefers-reduced-motion`, and a refused play leaves the poster up rather than an empty frame. A mono caption underneath names the stages left to right. It is allowed to break the 1040px column; nothing else is.

## Do's and Don'ts

### Do

- **Do** take colour, type, and corner language from the application unchanged.
- **Do** keep Signal Amber to one element per view, and make the masthead call to action an outline so the hero keeps the accent.
- **Do** colour the capability marks in board order, because the order is information.
- **Do** set commands, service names, and captions in IBM Plex Mono.
- **Do** put section headings in the left rail above 821px.
- **Do** lead with self-hosting; the hosted service is the convenience path, not the headline.
- **Do** review against `pnpm build` output, since the font preload plugin only runs on build.

### Don't

- **Don't** introduce a colour the application does not have, or a stock palette hue that means nothing.
- **Don't** colour a list to make it look lively; uniform chips are the correct answer for a set of equivalent things.
- **Don't** use Blueprint Teal as a fill, a button, or body text.
- **Don't** draw a second dashed rule.
- **Don't** add a resting shadow to anything that scrolls with the page.
- **Don't** repeat display size in a section, or let a second headline compete with the hero.
- **Don't** add a testimonial, logo wall, metric strip, or star count; none of that evidence exists.
- **Don't** put an eyebrow above the headline.
