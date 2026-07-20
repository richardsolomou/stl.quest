export function clientNeedsRefresh(serverVersion: string, clientVersion: string) {
  return serverVersion !== clientVersion
}
