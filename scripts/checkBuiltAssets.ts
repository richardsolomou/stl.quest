import fs from 'node:fs'
import path from 'node:path'

const serverRoot = '.output/server'
const publicRoot = '.output/public'
const stylesheetPattern = /\/assets\/styles-[A-Za-z0-9_-]+\.css/g
const stylesheets = new Set<string>()

for (const directory of fs.globSync(`${serverRoot}/**/*.mjs`)) {
  for (const stylesheet of fs.readFileSync(directory, 'utf8').match(stylesheetPattern) ?? []) stylesheets.add(stylesheet)
}

if (!stylesheets.size) throw new Error('the server build does not reference an application stylesheet')

for (const stylesheet of stylesheets) {
  const publicPath = path.join(publicRoot, stylesheet)
  if (!fs.existsSync(publicPath)) throw new Error(`server stylesheet is missing from the public build: ${stylesheet}`)
}
