import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const repositoryUrl = 'https://github.com/richardsolomou/stl.quest'
const rawRepositoryUrl = 'https://raw.githubusercontent.com/richardsolomou/stl.quest/main'
const profile = readFileSync('ca_profile.xml', 'utf8')
const template = readFileSync('deploy/unraid/stlquest.xml', 'utf8')

function requiredTag(xml: string, tag: string): string {
  const value = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1].trim()
  assert(value, `Missing non-empty <${tag}>`)
  return value
}

function assertHttps(tag: string, value: string): void {
  assert.equal(new URL(value).protocol, 'https:', `<${tag}> must use HTTPS`)
}

assert.match(profile, /<CommunityApplications>/)
requiredTag(profile, 'Profile')
for (const tag of ['Icon', 'WebPage', 'Forum']) assertHttps(tag, requiredTag(profile, tag))
assert.equal(requiredTag(profile, 'WebPage'), repositoryUrl)

assert.match(template, /<Container version="2">/)
for (const tag of ['Name', 'Repository', 'Overview', 'Category']) requiredTag(template, tag)
for (const tag of ['Registry', 'Support', 'Project', 'TemplateURL', 'ReadMe', 'Icon']) {
  assertHttps(tag, requiredTag(template, tag))
}
assert.equal(requiredTag(template, 'Project'), repositoryUrl)
assert.equal(requiredTag(template, 'TemplateURL'), `${rawRepositoryUrl}/deploy/unraid/stlquest.xml`)
assert.equal(requiredTag(template, 'ReadMe'), `${rawRepositoryUrl}/README.md`)

for (const [name, xml] of [
  ['ca_profile.xml', profile],
  ['deploy/unraid/stlquest.xml', template],
] as const) {
  assert.doesNotMatch(xml, /YOUR_|container_name|example-app/, `${name} contains a starter placeholder`)
}

console.log('Validated Unraid Community Apps metadata.')
