import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export async function verifyWritableDirectory(root: string) {
  const probe = path.join(root, `.stlquest-health-${crypto.randomUUID()}`)
  await fs.promises.writeFile(probe, '')
  await fs.promises.rm(probe, { force: true })
}
