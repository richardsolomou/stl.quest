import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type UpstreamSource = {
  id: string
  repository: string
  branch: string
  revision: string
  catalogPath: string
  licensePath: string
  licenseOutput: string
}

export function git(directory: string, ...arguments_: string[]) {
  return execFileSync('git', ['-C', directory, ...arguments_], { encoding: 'utf8' })
}

/** Shallow-fetches only `source.catalogPath`, at its pinned revision or, with `update`, the branch head it then records. */
export function checkoutSource(temporaryRoot: string, source: UpstreamSource, update: boolean) {
  const checkout = path.join(temporaryRoot, source.id)
  mkdirSync(checkout)
  git(checkout, 'init', '--quiet')
  git(checkout, 'remote', 'add', 'origin', source.repository)
  git(checkout, 'sparse-checkout', 'set', '--no-cone', `/${source.catalogPath}`)
  git(checkout, 'fetch', '--quiet', '--depth', '1', 'origin', update ? source.branch : source.revision)
  git(checkout, 'checkout', '--quiet', 'FETCH_HEAD')
  if (update) source.revision = git(checkout, 'rev-parse', 'HEAD').trim()
  return checkout
}

export function writeSourceLicense(root: string, checkout: string, source: UpstreamSource) {
  const output = path.join(root, source.licenseOutput)
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, git(checkout, 'show', `HEAD:${source.licensePath}`))
}

export function assertRevisions(
  generated: { id: string; revision: string }[],
  expected: { id: string; revision: string }[],
  catalog: string,
) {
  for (const source of expected) {
    if (generated.find((candidate) => candidate.id === source.id)?.revision !== source.revision) {
      throw new Error(`${source.id} revision does not match the generated ${catalog}`)
    }
  }
}
