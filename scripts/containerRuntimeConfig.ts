export function containerPublicPort(environment: NodeJS.ProcessEnv = process.env): number {
  const value = environment.PORT?.trim() || '3000'
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a valid TCP port')
  return port
}
