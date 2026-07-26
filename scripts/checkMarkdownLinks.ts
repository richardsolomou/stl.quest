import fs from 'node:fs/promises'
import path from 'node:path'

const missing: string[] = []
const linkPattern = /\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g

for await (const file of fs.glob('**/*.md', { exclude: ['.git/**', 'node_modules/**'] })) {
  const markdown = await fs.readFile(file, 'utf8')
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1] ?? match[2]
    if (/^(?:[a-z]+:|#)/i.test(target)) continue
    const localPath = decodeURIComponent(target.split('#', 1)[0])
    if (!localPath) continue
    try {
      await fs.access(path.resolve(path.dirname(file), localPath))
    } catch {
      missing.push(`${file}: ${target}`)
    }
  }
}

if (missing.length) throw new Error(`Missing local Markdown links:\n${missing.join('\n')}`)
console.log('Validated local Markdown links.')
