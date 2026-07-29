import { AssetStoreKeys } from './assetStoreKeys'
import { OAuthAccessTokenCache, type OAuthAccessToken } from './oauthAccessToken'

export abstract class OAuthAssetStoreKeys extends AssetStoreKeys {
  private accessTokens = new OAuthAccessTokenCache()

  protected token() {
    return this.accessTokens.get(() => this.refreshAccessToken())
  }

  protected abstract refreshAccessToken(): Promise<OAuthAccessToken>
}
