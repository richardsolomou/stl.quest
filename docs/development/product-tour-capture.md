# Capturing the product tour GIF

`scripts/productTour/capture/` holds the reproducible capture code for the animated README preview. Recordings land in the ignored `.capture/`; the published copy lives in `public/`.

## Outputs

| Command            | Output                      | Destination                                                                       |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| `pnpm tour:gif`    | `.capture/product-tour.gif` | Copy to `public/`; the README loads it from `https://stl.quest/product-tour.gif`. |
| `pnpm tour:verify` | `.capture/verify/*.png`     | Inspect locally before recording; do not commit these screenshots.                |

The scripts target `http://localhost:3001` by default. Override that with `BASE`. Demo credentials default to `richard@stl.quest` and `demo-demo-demo`; `DEMO_EMAIL` and `DEMO_PASSWORD` override them.

## Prerequisites

- Node 24 and this repository installed with `pnpm install`.
- The capture browser, installed once with `pnpm exec playwright install chromium`.
- `ffmpeg` with PNG and GIF palette support.
- A running STL Quest instance seeded with a demo workspace. The curated demo dataset is built from sanitized production data by a private tool outside this repository, which seeds a local instance, starts it, and runs these capture commands. `scripts/seedPowerUser.ts` seeds fictional data that also works; it turns usage tracking on, so turn off **Track usage and stock** in General settings before recording. Otherwise point `BASE` at any instance whose data you are willing to publish.

Usage tracking must stay off, as it is by default, or step sheets interrupt the loop. Recording changes the board, so reseed and restart the instance before each take, and let it finish generating model thumbnails first. `pnpm tour:verify` leaves the board unchanged.

## Publishing

Copy `.capture/product-tour.gif` to `public/product-tour.gif`. Deploying the hosted service updates the animation shown in the README.

Before publishing, verify that no real names, email addresses, profile images, URLs, filenames, secrets, or other identifiers are visible.

## Editing the shot

`scripts/productTour/capture/record.ts` holds the scene: a queued print moves up next, then the print that fires next is started on an idle printer from its Start printing menu, taken off the printer, and marked ready. Its dimensions and pacing live in `scripts/productTour/capture/config.ts`; prefer adjusting `speed` before changing individual pauses.

The capture deliberately signs in before recording, injects a visible cursor, and uses stepped mouse movement and wheel scrolling for readable actions. Preserve these mechanics unless the replacement is validated in the rendered output.

The scene picks cards and printers by position, through the shared selectors in `config.ts`, so it runs on any demo data with a full queue and at least one idle printer for the next print. A missing card, menu, or button should fail the take rather than silently record dead air. If a selector breaks after an application change, inspect the live demo with `pnpm tour:verify`, update only the affected action, and record the full scene again.
