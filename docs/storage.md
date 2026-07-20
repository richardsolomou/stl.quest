# Storage providers

PrintHub stores model files in a local folder, an S3-compatible bucket, or a connected Dropbox, Google Drive, or OneDrive account. Settings → Storage walks through each connection and displays the exact OAuth redirect URI to copy, so this page covers only what the in-app guidance cannot: the provider-console setup, its gotchas, and how switching providers works.

Every provider receives an enforced workspace namespace below the configured root. OAuth client secrets and refresh tokens are encrypted at rest with `/data/integration-secrets.key` (or `INTEGRATIONS_ENCRYPTION_KEY`).

## Redirect URIs

Each cloud provider needs the deployment's callback URL registered in its console. Settings → Storage shows the exact value; the pattern is:

| Provider     | Redirect URI                                          |
| ------------ | ----------------------------------------------------- |
| Dropbox      | `https://your-host/api/storage/dropbox/callback`      |
| Google Drive | `https://your-host/api/storage/google-drive/callback` |
| OneDrive     | `https://your-host/api/storage/onedrive/callback`     |

Behind a reverse proxy, the host must match `BETTER_AUTH_URL`.

## Dropbox

Create a scoped app with **App folder** access (not Full Dropbox) at the Dropbox App Console — PrintHub only ever sees its own `Apps/<your app>` folder. Dropbox labels the credentials "App key" and "App secret"; they map to PrintHub's client ID and secret fields. Grant the `account_info.read`, `files.metadata.read`, `files.content.read`, and `files.content.write` scopes; PrintHub probes the connection with a test file and reports any missing scope.

## Google Drive

In Google Cloud Console, enable the **Google Drive API** and configure the OAuth consent screen before creating a **Web application** OAuth client — the client cannot be created without the consent screen. PrintHub requests only the `drive.file` scope, which sees just the files and folders it creates itself (a `PrintHub` folder in the account), never the rest of the Drive; the scope is non-sensitive, so Google's app verification is not required. Expect the "unverified app" interstitial on first connect — that is normal for a self-hosted deployment.

## OneDrive

Register a web application in Microsoft Entra and create a client secret. PrintHub signs in through the `/common` endpoint, so set **Supported account types** to "Accounts in any organizational directory and personal Microsoft accounts" — a single-tenant registration rejects sign-ins. Add `User.Read`, `Files.ReadWrite`, and `offline_access` as **delegated** Microsoft Graph permissions (not application permissions). Files live in OneDrive's dedicated `Apps/<your app>` folder. Refresh tokens rotate automatically; no action is needed when that happens.

## S3-compatible services

Presets cover Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, and Google Cloud Storage (via HMAC keys); endpoints are derived from the region or account ID, and presets always use virtual-hosted-style addressing. The **Custom** provider accepts any S3-compatible endpoint (MinIO, Wasabi, NAS gateways) and defaults to path-style requests, which most self-hosted endpoints require — the path-style toggle exists only there.

## Local folders

Folder paths are inside the PrintHub server or container, not the host — mount a host directory first (for example `-v /path/to/prints:/prints`), then pick it in the folder browser. PrintHub adds a private workspace directory below the selected folder.

## Cloud request recovery

Dropbox, Google Drive, and OneDrive requests retry provider throttling and temporary server failures. Each network attempt stops after two minutes so a stalled provider cannot hold an upload, download, storage migration, or connection check open indefinitely. Relative paths containing empty, `.` or `..` segments are rejected before reaching the provider.

## Generated assets

Thumbnail, preview, and dimension generation uses a 256 MiB memory budget with a conservative four-times source-size estimate. Models larger than 64 MiB remain available for download and queue management, but generated assets are marked failed instead of risking an out-of-memory restart.

## Switching providers

Changing storage starts a guided migration: PrintHub copies and verifies every referenced file into the new location while file changes are paused, then switches. The migration can be cancelled or retried, and the original files stay in place as a fallback — clean them up manually once you trust the new location.
