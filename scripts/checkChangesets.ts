import fs from 'node:fs/promises'

const { name: expectedName } = JSON.parse(await fs.readFile('package.json', 'utf8'))

const bad: string[] = []

for await (const file of fs.glob('.changeset/*.md')) {
  if (file.endsWith('README.md')) continue
  const contents = await fs.readFile(file, 'utf8')
  const frontmatter = contents.match(/^---\n([\s\S]*?)\n---/)?.[1]
  if (!frontmatter) {
    bad.push(`${file}: missing frontmatter`)
    continue
  }
  for (const line of frontmatter.split('\n')) {
    const packageName = line.match(/^['"]?([^'":]+)['"]?:\s*(?:patch|minor|major)\s*$/)?.[1]
    if (packageName === undefined) continue
    if (packageName !== expectedName) {
      bad.push(`${file}: references package "${packageName}", but package.json is "${expectedName}"`)
    }
  }
}

if (bad.length) throw new Error(`Invalid changesets:\n${bad.join('\n')}`)
console.log('Validated changeset package names.')
