import { assetMissingError } from './missingFile'

export async function prepareAssetMove<Asset>(
  sourcePath: string,
  destinationPath: string,
  inspect: (path: string) => Promise<Asset | undefined>,
  size: (asset: Asset) => unknown,
) {
  if (sourcePath === destinationPath) return undefined
  const [source, destination] = await Promise.all([inspect(sourcePath), inspect(destinationPath)])
  if (!source && destination) return undefined
  if (!source) throw assetMissingError(sourcePath)
  if (destination && size(destination) !== size(source)) throw new Error(`asset destination already exists: ${destinationPath}`)
  return { source, destination }
}

// The source asset can vanish between prepareAssetMove's lookup above and the
// move mutation itself: a concurrent or duplicate delete, or provider listing
// lag, races the request so the store reports the source as gone moments after
// it was seen. Treat a vanished source as an already-completed move — the same
// tolerance each store's delete already applies to a 404 — so the logical delete
// proceeds instead of crashing the board action with an unhandled error.
// prepareAssetMove still throws ENOENT when neither endpoint ever existed, so a
// genuinely missing asset is unaffected.
export async function moveIgnoringMissingSource(move: () => Promise<unknown>, missing: (error: unknown) => boolean) {
  try {
    await move()
  } catch (error) {
    if (!missing(error)) throw error
  }
}
