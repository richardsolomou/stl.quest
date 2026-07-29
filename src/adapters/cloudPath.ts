export function cleanCloudRoot(root: string, provider: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (cleaned.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Response(`invalid ${provider} folder`, { status: 400 })
  }
  return cleaned
}

export function cloudFileName(relativePath: string) {
  return relativePath.split('/').pop()!
}
