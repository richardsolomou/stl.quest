export type OAuthAccessToken = { value: string; expiresInSeconds: number }

export class OAuthAccessTokenCache {
  private current?: { value: string; expiresAt: number }
  private refreshing?: Promise<string>

  get(refresh: () => Promise<OAuthAccessToken>) {
    if (this.current && this.current.expiresAt > Date.now()) return Promise.resolve(this.current.value)
    this.refreshing ??= refresh()
      .then(({ value, expiresInSeconds }) => {
        this.current = { value, expiresAt: Date.now() + Math.max(expiresInSeconds - 60, 1) * 1_000 }
        return value
      })
      .finally(() => {
        this.refreshing = undefined
      })
    return this.refreshing
  }
}
