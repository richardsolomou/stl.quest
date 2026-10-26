# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The visitor is someone who already 3D prints for other people and has outgrown the way they currently track it — a group chat, a spreadsheet, or their memory. They arrive from GitHub, a NAS app catalogue, a forum, or a search for a print queue, and they are evaluating rather than using: they want to know what this is, whether it will run where they want it, and what happens to their model files.

They skew technical. Someone who owns resin and filament printers and is considering a Docker container or a TrueNAS app is comfortable reading a command. The page can be dense and concrete without losing them, and vague marketing language costs more trust than it buys.

This is the same product and the same primary user as the application: the operator who runs the queue. The difference is only that here they have not decided yet.

## Product Purpose

Explain STL Quest well enough for the right person to start using it, and honestly enough that the wrong person does not. Success is a visitor who understands within one screen what the product does, sees it running, and picks a way to run it.

## Positioning

**Self-hosting is the hook.** The page leads with ownership: this is free, open source, and runs on hardware the visitor controls. The hosted service is the convenience path for people who do not want to run a server, not the headline. Per-copy tracking is the other durable claim, carried by the product tour and the "Follow every copy" capability rather than stated as a slogan.

## Operating Context

- One page plus two legal pages (`/terms`, `/privacy`). No blog, docs, changelog, or pricing page lives here.
- The landing page is part of the application and only the hosted service routes it (`STLQUEST_HOSTED=true`): `/` for signed-out visitors and `/home` for everyone. It renders the application's components and design tokens and reads product facts from `src/core` instead of restating them. Sign-in moves to `/sign-in`.
- Server-rendered by the application like every other route, so first paint carries content before the bundle parses.
- `src/client/landing/discovery.ts` builds each page's head (title, description, social tags, canonical address, the home page's JSON-LD, and the `robots` override) and `sitemap.xml`; `src/client/landing/llms.ts` writes `llms.txt`, the answer-engine summary of the product, which is held to the same rule as the page: no claim may outrun the product. A new page is added to `PAGES` in `src/client/landing/site.ts` and given a route.
- The product tour video and its poster are recorded by the Playwright capture scripts in `scripts/productTour/capture/`; the published copies live in `public/`, so every image carries them.

## Capabilities and Constraints

- **No claim may outrun the product.** Everything on the page has to be true of the shipped application, including for the hosted path. "Your files stay yours" has to stay compatible with included hosted storage.
- **Fonts use `font-display: optional` and are preloaded** by `landingHead`, through `src/client/landing/landing.css`, which only the landing routes load. This is deliberate: it trades a small chance of falling back for a guarantee of no layout shift.
- The site sends anonymous analytics, web vitals, errors, heatmaps, and session replays to PostHog, configured through Vite environment variables.
- It ships in the application image and deploys with it.
- The repository's toolchain and gates apply; `src/client/landing/*.test.ts` covers the head, sitemap, and `llms.txt`, and the hosted e2e spec enters through the landing page.

## Brand Commitments

- **Name, wordmark, and palette are shared with the application** and are not the website's to reinterpret. The site is a surface of one product, not a sibling brand.
- **Voice:** plain, concrete, operator-to-operator. States what the product does and where its edges are. No hype words, no invented urgency.
- **Terminology is fixed:** the five stages are Queue, Up next, Printing, Finishing, Ready. Print types are resin and filament.

## Evidence on Hand

- A real product tour recorded from the running application, shown above the fold as video with a static poster.
- Real distribution listings: TrueNAS Apps catalogue, Unraid Community Apps, GHCR container images, and a working `docker run` command.
- Public source under AGPL-3.0.
- **No testimonials, named customers, user counts, benchmarks, uptime figures, or press exist.** Do not invent them, and do not add a social-proof section that would need them.

## Product Principles

1. **Show it running.** The product tour does more work than any sentence on the page; protect its position and its clarity.
2. **Lead with ownership.** The first thing a visitor learns is that this is theirs to run.
3. **Be specific enough to be checkable.** A real command, a real catalogue link, a real licence beats an adjective.
4. **Say what it does not do.** The boundary is a feature, not an omission to paper over.
5. **The site is a surface of the product, not a separate identity.** When the two could diverge, the application's system wins.

## Accessibility & Inclusion

No formal standard has been established. Contrast currently clears 4.5:1 throughout and reduced-motion preferences are honoured for both scroll behaviour and product tour autoplay; keep both true rather than treating them as a baseline someone else set.
