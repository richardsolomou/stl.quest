# Capturing product tour media

`website/scripts/capture/` holds the reproducible capture code for the landing-page product tour and the animated README preview. Recordings land in the ignored `website/.capture/`; the published copies live in `website/public/`.

## Outputs

| Command                       | Output                                                                                           | Destination                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `pnpm website:capture:video`  | `website/.capture/landing.mp4`, `website/.capture/landing.webm`, `website/.capture/landing.webp` | Copy to the corresponding `website/public/product-tour.*` files.                                          |
| `pnpm website:capture:gif`    | `website/.capture/product-tour.gif`                                                              | Copy to `website/public/product-tour.gif`; the README loads it from `https://stl.quest/product-tour.gif`. |
| `pnpm website:capture:verify` | `website/.capture/verify/*.png`                                                                  | Inspect locally before recording; do not commit these screenshots.                                        |

The scripts target `http://localhost:3001` by default. Override that with `BASE`. Demo credentials default to `richard@stl.quest` and `demo-demo-demo`; `DEMO_EMAIL` and `DEMO_PASSWORD` override them.

## Prerequisites

- Node 24 and this repository installed with `pnpm install`.
- The capture browser, installed once with `pnpm exec playwright install chromium`.
- `ffmpeg` with H.264, WebM, PNG, and GIF palette support, plus `cwebp` for the poster image.
- A running STL Quest instance seeded with the demo workspace. The demo dataset is built from sanitized production data by a private tool outside this repository, which seeds a local instance, starts it, and runs these capture commands one scene at a time. Without it, point `BASE` at any instance whose data you are willing to publish.

Recording changes the board. Reseed and restart the instance between the two capture commands rather than running them against the same seed.

## Publishing

Copy `website/.capture/landing.mp4`, `website/.capture/landing.webm`, and `website/.capture/landing.webp` over the corresponding `website/public/product-tour.*` files, then run `pnpm website:build` and inspect the rendered page at desktop and mobile widths through a complete playback cycle.

Copy `website/.capture/product-tour.gif` to `website/public/product-tour.gif`. Deploying the website updates the animation shown in the README.

Before publishing either asset, verify that no real names, email addresses, profile images, URLs, filenames, secrets, or other identifiers are visible.

## Editing the shot

`website/scripts/capture/record.ts` contains two scenes: `landing` is the full website tour and `gif` is the short README loop. Their dimensions and pacing live in `website/scripts/capture/config.ts`; prefer adjusting `speed`, `trim`, and, for the video, `orbitSpeed` before changing individual pauses.

The capture deliberately signs in before recording, injects a visible cursor, uses stepped mouse movement for readable actions, and dispatches the 3D orbit inside the page for smooth animation. Playwright does not record its native drag ghost. Preserve these mechanics unless the replacement is validated in the rendered output.

Selectors describe the curated demo data and are intentionally strict. A missing card, menu, or dialog should fail the take rather than silently record dead air. If a selector breaks after an application change, inspect the live demo, update only the affected action, and record the full scene again.
