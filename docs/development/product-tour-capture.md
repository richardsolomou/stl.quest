# Capturing product tour media

`scripts/productTour/capture/` holds the reproducible capture code for the landing-page product tour and the animated README preview. Recordings land in the ignored `.capture/`; the published copies live in `public/`.

## Outputs

| Command            | Output                                                                   | Destination                                                                                       |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm tour:video`  | `.capture/landing.mp4`, `.capture/landing.webm`, `.capture/landing.webp` | Copy to the corresponding `public/product-tour.*` files.                                          |
| `pnpm tour:gif`    | `.capture/product-tour.gif`                                              | Copy to `public/product-tour.gif`; the README loads it from `https://stl.quest/product-tour.gif`. |
| `pnpm tour:verify` | `.capture/verify/*.png`                                                  | Inspect locally before recording; do not commit these screenshots.                                |

The scripts target `http://localhost:3001` by default. Override that with `BASE`. Demo credentials default to `richard@stl.quest` and `demo-demo-demo`; `DEMO_EMAIL` and `DEMO_PASSWORD` override them.

## Prerequisites

- Node 24 and this repository installed with `pnpm install`.
- The capture browser, installed once with `pnpm exec playwright install chromium`.
- `ffmpeg` with H.264, WebM, PNG, and GIF palette support, plus `cwebp` for the poster image.
- A running STL Quest instance seeded with the demo workspace. The demo dataset is built from sanitized production data by a private tool outside this repository, which seeds a local instance, starts it, and runs these capture commands one scene at a time. Without it, point `BASE` at any instance whose data you are willing to publish.

Recording changes the board. Reseed and restart the instance between the two capture commands rather than running them against the same seed.

## Publishing

Copy `.capture/landing.mp4`, `.capture/landing.webm`, and `.capture/landing.webp` over the corresponding `public/product-tour.*` files, then run `pnpm build` and inspect the rendered page at desktop and mobile widths through a complete playback cycle.

Copy `.capture/product-tour.gif` to `public/product-tour.gif`. Deploying the hosted service updates the animation shown in the README.

Before publishing either asset, verify that no real names, email addresses, profile images, URLs, filenames, secrets, or other identifiers are visible.

## Editing the shot

`scripts/productTour/capture/record.ts` contains two scenes: `landing` is the full landing-page tour and `gif` is the short README loop. Their dimensions and pacing live in `scripts/productTour/capture/config.ts`; prefer adjusting `speed`, `trim`, and, for the video, `orbitSpeed` before changing individual pauses.

The capture deliberately signs in before recording, injects a visible cursor, uses stepped mouse movement for readable actions, and dispatches the 3D orbit inside the page for smooth animation. Playwright does not record its native drag ghost. Preserve these mechanics unless the replacement is validated in the rendered output.

Selectors describe the curated demo data and are intentionally strict. A missing card, menu, or dialog should fail the take rather than silently record dead air. If a selector breaks after an application change, inspect the live demo, update only the affected action, and record the full scene again.
