import path from 'node:path'

export function databasePath(dataDirectory = process.env.DATA_DIR ?? '/data') {
  return path.join(path.resolve(dataDirectory), 'stlquest.sqlite')
}
