import catalogue from '../../catalogs/filaments/spoolman.generated.json'
import type { SpoolmanCatalogue } from './spoolman'

/** Generated with the filament catalogue (scripts/filamentCatalog.ts); only the server matches, so browsers never load it. */
export const SPOOLMAN_CATALOGUE = catalogue as unknown as SpoolmanCatalogue
