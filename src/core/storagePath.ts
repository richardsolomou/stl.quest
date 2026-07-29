export function hasTraversalSegment(path: string) {
  return path.split('/').some((segment) => segment === '.' || segment === '..')
}

export function hasInvalidRelativePathSegment(path: string) {
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}
