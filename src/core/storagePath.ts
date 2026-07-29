export function hasTraversalSegment(path: string) {
  return path.split('/').some((segment) => segment === '.' || segment === '..')
}

export function hasInvalidRelativePathSegment(path: string) {
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
}

export function assertRelativeStoragePath(path: string, allowEmpty = false) {
  if ((!path && !allowEmpty) || (path && hasInvalidRelativePathSegment(path))) {
    throw new Response('invalid path', { status: 400 })
  }
}
