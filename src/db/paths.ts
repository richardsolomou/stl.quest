import path from 'node:path'

export function databasePath(directory = process.env.DATA_DIR ?? '/data') {
  const dataDirectory = path.resolve(directory)
  return path.join(dataDirectory, 'stlquest.sqlite')
}
