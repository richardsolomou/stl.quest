# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The visitor already 3D prints for other people and has outgrown the way they track it: a group chat, a spreadsheet, or memory. It might be one printer and a few friends, or a print farm with paying customers. They arrive from GitHub, a NAS app catalogue, a forum, or a search for a print queue, and they are evaluating rather than using. They want to know what this is, whether it fits how they work, whether it runs where they want it, and what happens to their model files.

They skew technical. Someone who owns resin and filament printers and is weighing a Docker container or a TrueNAS app is comfortable reading a command. The page can be dense and concrete without losing them, and vague marketing language costs more trust than it buys.

This is the same product and the same primary user as the application: the operator who runs the queue. The only difference is that here they have not decided yet.

## Product Purpose

Explain STL Quest well enough for the right person to start using it, and honestly enough that the wrong person does not. Success is a visitor who understands within one screen what the product does and that it is theirs to run, then sees it working and picks a way to start: copy the Docker command, install from their NAS catalogue, or create a hosted workspace.

## Positioning

**Ownership is the hook.** The headline says the queue is the visitor's to run, and the self-hosting path (the Docker command) sits in the first viewport as a working action. The hosted service is the convenience path and carries the page's one red button, because it is the one action the page can complete for the visitor.

**Per-copy tracking is the durable claim**, shown rather than stated: the real board, and an interactive ticket whose copies move stage by stage.

**What sets it apart now** is everything around the queue that the visitor would otherwise keep in another spreadsheet: catalogues for printers and materials, quotes from real costs, and optional usage, stock, maintenance, and spend tracking.

## Operating Context

- One page plus two legal pages (`/terms`, `/privacy`). No blog, docs, changelog, or pricing page lives here; plans are a short table on the home page.
- The landing pages are part of the application and only the hosted service routes them (`STLQUEST_HOSTED=true`): `/` for signed-out visitors and `/home` for everyone. They render the application's components and design tokens and read product facts from `src/core` instead of restating them. Sign-in lives at `/sign-in`.
- They follow the visitor's light or dark scheme, like the application, and are server-rendered so first paint carries content before the bundle parses.
- `src/client/landing/discovery.ts` builds each page's head (title, description, social tags, canonical address, the home page's JSON-LD, and the `robots` override) and `sitemap.xml`. `src/client/landing/llms.ts` writes `llms.txt`, the answer-engine summary of the product, which is held to the same rule as the page: no claim may outrun the product. A new page is added to `PAGES` in `src/client/landing/site.ts` and given a route.
- What the product leaves to other tools is one list in `site.ts` (`OUTSIDE_THE_PRODUCT`) that both the page and `llms.txt` read.
- Product imagery is real: screenshots of the running application in both themes, captured from the demo print-farm workspace (`scripts/seedPowerUser.ts`) and published as `public/landing-*.webp`.

## Capabilities and Constraints

- **No claim may outrun the product.** Everything on the page has to be true of the shipped application, including for the hosted path. "Your files stay yours" has to stay compatible with included hosted storage, and usage tracking is described as off until an admin turns it on.
- **Facts come from `src/core`:** the five stages and their order (`workflow`), the hosted plans and their storage (`storagePlans`), the model formats (`MODEL_FORMATS`), and the cloud storage providers. Prose that describes a stage is keyed by the stage's ID.
- **Fonts use `font-display: optional` and are preloaded** by `landingHead`, through `src/client/landing/landing.css`, which only the landing routes load. This trades a small chance of falling back for a guarantee of no layout shift.
- The site sends anonymous analytics, web vitals, errors, heatmaps, and session replays to PostHog, configured through Vite environment variables. Landing events are limited to `website_link_clicked` and `docker_command_copy_completed` (see `docs/telemetry.md`).
- It ships in the application image and deploys with it. Images are self-hosted; the Content Security Policy needs no landing-specific sources.
- The repository's toolchain and gates apply; `src/client/landing/*.test.ts` covers the head, sitemap, `llms.txt`, and when the landing shows, and the hosted e2e spec enters through the landing page.

## Brand Commitments

- **Name, wordmark, palette, and type are shared with the application** and are not the website's to reinterpret. The site is a surface of one product, not a sibling brand.
- **Voice:** plain, concrete, operator-to-operator. States what the product does and where its edges are. No hype words, no invented urgency.
- **Terminology is fixed:** the five stages are Queue, Up next, Printing, Finishing, Ready. Print types are resin and filament.

## Evidence on Hand

- Real screenshots of the running application in both themes: the board on desktop and phone, the rough quote, the filament catalogue with its colour swatches, and the spend view. The board's demo data is labelled as a demo.
- Real distribution listings: TrueNAS Apps catalogue, Unraid Community Apps, GHCR container images, and a working `docker run` command.
- Public source under AGPL-3.0, with releases and a changelog.
- **No testimonials, named customers, user counts, benchmarks, uptime figures, or press exist.** Do not invent them, and do not add a social-proof section that would need them.

## Product Principles

1. **Show it running.** Real screenshots and a ticket the visitor can move do more work than any sentence on the page.
2. **Lead with ownership.** The first thing a visitor learns is that this is theirs to run, and the command to run it is in the first viewport.
3. **Be specific enough to be checkable.** A real command, a real catalogue link, a real licence, a real price beats an adjective.
4. **Say what it does not do.** The boundary is drawn on the page as empty slots, not left implied.
5. **The site is a surface of the product, not a separate identity.** When the two could diverge, the application's system wins.
6. **One printer to a print farm.** The page speaks to both ends and never implies the product is only for one of them.

## Accessibility & Inclusion

No formal standard has been established. Body text clears 4.5:1 in both themes, every screenshot carries alt text describing what it shows, the copy ticket announces each move through a live region, and reduced-motion preferences turn off the ticket settle and cell stamp. Keep all of that true rather than treating it as a baseline someone else set.
