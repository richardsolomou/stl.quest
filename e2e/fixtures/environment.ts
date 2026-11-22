// PLAYWRIGHT_PORT names a run: its ports, data root, container names, and image all derive from it, so checkouts that
// pick ports 400 apart can run e2e side by side. The default port keeps the bare names CI uses.
export const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
export const e2eSuffix = e2ePort === 4173 ? '' : `-${e2ePort}`
// runE2e.sh pins the image to its base port, so a run on a second port still tests the same build.
export const e2eImage = process.env.STLQUEST_E2E_IMAGE ?? `stlquest-e2e${e2eSuffix}`
export const e2eDataRoot = process.env.PLAYWRIGHT_DATA_ROOT ?? `/tmp/stlquest-playwright-${e2ePort}`
export const e2eContainer = (name: string) => `stlquest-e2e-${name}${e2eSuffix}`
