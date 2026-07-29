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
