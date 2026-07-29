export function cleanCloudRoot(root: string, provider: string) {
  const cleaned = root.trim().replace(/^\/+|\/+$/g, '')
  if (hasTraversalSegment(cleaned)) {
    throw new Response(`invalid ${provider} folder`, { status: 400 })
  }
  return cleaned
}

export function cloudFileName(relativePath: string) {
  return relativePath.split('/').pop()!
}

export function joinCloudPath(root: string, relativePath: string) {
  return [root, relativePath].filter(Boolean).join('/')
}
import { hasTraversalSegment } from '../core/storagePath'
