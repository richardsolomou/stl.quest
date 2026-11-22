import type { SlicerId } from './slicers'

/** An external app STL Quest opens or connects to. */
export type AppId = SlicerId | 'spoolman' | 'bambuddy'

/** Each app's official icon, served from `public/`; `catalogs/app-logos/sources.json` records where each came from. */
export const APP_LOGOS = {
  'bambu-studio': '/app-logos/bambu-studio.svg',
  orcaslicer: '/app-logos/orcaslicer.svg',
  prusaslicer: '/app-logos/prusaslicer.svg',
  cura: '/app-logos/cura.svg',
  chitubox: '/app-logos/chitubox.png',
  lychee: '/app-logos/lychee.png',
  preform: '/app-logos/preform.png',
  'heygears-blueprint': '/app-logos/heygears-blueprint.png',
  'elegoo-satellite': '/app-logos/elegoo-satellite.png',
  'anycubic-photon-workshop': '/app-logos/anycubic-photon-workshop.png',
  dragonfruit: '/app-logos/dragonfruit.svg',
  spoolman: '/app-logos/spoolman.svg',
  bambuddy: '/app-logos/bambuddy.png',
} as const satisfies Record<AppId, string>
