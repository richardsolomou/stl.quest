import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postHogSourceMaps } from './posthogSourceMaps'

const credentials = { POSTHOG_CLI_API_KEY: 'phx_test', POSTHOG_CLI_PROJECT_ID: '1' }
let directory: string

// The plugin runs the first `posthog-cli` it finds under the working directory; this one records what it was given.
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'posthog-source-maps-'))
  const bin = path.join(directory, 'node_modules', '.bin')
  await mkdir(bin, { recursive: true })
  await writeFile(path.join(bin, 'posthog-cli'), `#!/bin/sh\necho "$@" >> "${directory}/cli.log"\ncat >> "${directory}/cli.log"\n`)
  await chmod(path.join(bin, 'posthog-cli'), 0o755)
  vi.spyOn(process, 'cwd').mockReturnValue(directory)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('postHogSourceMaps', () => {
  it('skips a local build that has credentials', () => {
    expect(postHogSourceMaps(credentials)).toBeUndefined()
  })

  it('uploads from CI with credentials', () => {
    expect(postHogSourceMaps({ ...credentials, CI: 'true' })).toBeDefined()
  })

  it('skips CI without credentials', () => {
    expect(postHogSourceMaps({ CI: 'true' })).toBeUndefined()
  })

  it('skips CI when uploads are turned off', () => {
    expect(postHogSourceMaps({ ...credentials, CI: 'true', POSTHOG_UPLOAD_SOURCEMAPS: 'false' })).toBeUndefined()
  })

  it('uploads from anywhere when uploads are turned on', () => {
    expect(postHogSourceMaps({ ...credentials, POSTHOG_UPLOAD_SOURCEMAPS: 'true' })).toBeDefined()
  })

  it('fails a build that must upload without credentials', () => {
    expect(() => postHogSourceMaps({ POSTHOG_UPLOAD_SOURCEMAPS: 'true' })).toThrow(
      'Uploading source maps needs POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID',
    )
  })

  it('instruments only the client environment', () => {
    const { client } = postHogSourceMaps({ ...credentials, CI: 'true' })!
    expect(['client', 'ssr'].map((name) => client.applyToEnvironment({ name }))).toEqual([true, false])
  })

  it('gives each worker build its own plugin instance', () => {
    const { worker } = postHogSourceMaps({ ...credentials, CI: 'true' })!
    expect(worker()).not.toBe(worker())
  })
})

describe('an uploading build', () => {
  async function uploadingBuild() {
    await writeFile(path.join(directory, 'entry.js'), 'export const answer = () => 42\n')
    const { client } = postHogSourceMaps({ ...credentials, CI: 'true' })!
    await build({
      root: directory,
      configFile: false,
      logLevel: 'silent',
      plugins: [client],
      build: {
        outDir: path.join(directory, 'dist'),
        lib: { entry: path.join(directory, 'entry.js'), formats: ['es'], fileName: () => 'entry.js' },
      },
    })
    return { dist: path.join(directory, 'dist'), log: await readFile(path.join(directory, 'cli.log'), 'utf8') }
  }

  it('uploads the built chunk', async () => {
    const { dist, log } = await uploadingBuild()
    expect(log).toContain(path.join(dist, 'entry.js'))
  })

  it('leaves no source map in the output', async () => {
    const { dist } = await uploadingBuild()
    expect((await readdir(dist)).filter((file) => file.endsWith('.map'))).toEqual([])
  })

  it('leaves no source map reference in the chunk', async () => {
    const { dist } = await uploadingBuild()
    expect(await readFile(path.join(dist, 'entry.js'), 'utf8')).not.toContain('sourceMappingURL')
  })
})
