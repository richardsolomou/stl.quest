# Storage providers

PrintHub stores model files in a local folder, a remote WebDAV folder, an S3-compatible bucket, or a connected Dropbox, Google Drive, or OneDrive account. Settings → Storage walks through each connection and displays the exact OAuth redirect URI to copy, so this page covers only what the in-app guidance cannot: the provider-console setup, its gotchas, and how switching providers works.

Every provider receives an enforced workspace namespace below the configured root. OAuth client secrets and refresh tokens are encrypted at rest with `/data/integration-secrets.key` (or `INTEGRATIONS_ENCRYPTION_KEY`).

When `PRINTHUB_HOSTED=true`, local folders and the server folder browser are available only to workspaces created by a super admin. Existing local files in other workspaces remain readable so an admin can migrate them, but uploads stay blocked until the workspace uses S3-compatible or connected cloud storage.

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

## Remote folders over WebDAV

WebDAV keeps files as ordinary files and folders on a machine or NAS you control. PrintHub creates status folders such as `todo` and `done`, moves files between them as requests progress, and stores generated previews below `.printhub`. You can inspect or copy these files directly, but renaming or deleting files that PrintHub still references will make those assets unavailable.

Run a WebDAV server for the chosen folder and give PrintHub a dedicated username and password. Hosted PrintHub requires a stable HTTPS endpoint. The machine, WebDAV server, and tunnel must remain online whenever PrintHub reads or writes a file.

### Cloudflare Tunnel

Create a tunnel on the storage machine and route one public HTTPS hostname to the local WebDAV service. The connector initiates the connection to Cloudflare, so no inbound router port is required. Expose only the WebDAV service, use dedicated WebDAV credentials, and do not route a NAS or server administration interface through the same hostname. Browser-based Cloudflare Access login is not compatible with background file operations; PrintHub authenticates directly to WebDAV.

### Tailscale

Tailscale Serve is private to a tailnet, so a hosted PrintHub server cannot reach it unless the server also joins that customer's tailnet. Tailscale Funnel publishes the WebDAV service through a public HTTPS address and works without joining the tailnet. Use dedicated WebDAV credentials because the Funnel endpoint is internet-reachable.

In Settings → Storage, choose **Remote folder (WebDAV)**, enter the HTTPS endpoint and folder, then provide the dedicated credentials. Model files and generated previews are stored in that folder, while workspace metadata remains in PrintHub's SQLite database and in-progress upload chunks temporarily use the hosted server's `DATA_DIR` until the upload is finalized.

## S3-compatible services

Presets cover Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, and Google Cloud Storage (via HMAC keys); endpoints are derived from the region or account ID, and presets always use virtual-hosted-style addressing. The **Custom S3-compatible** provider accepts any S3-compatible endpoint (MinIO, Wasabi, NAS gateways) and defaults to path-style requests, which most self-hosted endpoints require — the path-style toggle exists only there.

## Local folders

Folder paths are inside the PrintHub server or container, not the host — mount a host directory first (for example `-v /path/to/prints:/prints`), then pick it in the folder browser. PrintHub adds a private workspace directory below the selected folder.

## Cloud request recovery

Dropbox, Google Drive, and OneDrive requests retry provider throttling and temporary server failures. Each network attempt stops after two minutes so a stalled provider cannot hold an upload, download, storage migration, or connection check open indefinitely. Relative paths containing empty, `.` or `..` segments are rejected before reaching the provider.

## Generated assets

Thumbnail, preview, and dimension generation uses a 256 MiB memory budget with a conservative four-times source-size estimate. Models larger than 64 MiB remain available for download and queue management, but generated assets are marked failed instead of risking an out-of-memory restart.

## Switching providers

Changing storage starts a guided migration: PrintHub copies and verifies every referenced file into the new location while file changes are paused, then switches. The migration can be cancelled or retried, and the original files stay in place as a fallback — clean them up manually once you trust the new location.
