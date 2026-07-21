import path from 'node:path'

export function databasePath() {
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? '/data')
  return path.join(dataDirectory, 'stlquest.sqlite')
}
