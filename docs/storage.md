# Storage providers

STL Quest can store models in deployment-managed storage, a local folder, a remote WebDAV folder, an S3-compatible bucket, Dropbox, Google Drive, or OneDrive. **Settings → Storage** guides you through the connection. This page covers the extra setup required by each provider and explains what happens when you switch storage.

Dropbox, Google Drive, and OneDrive take two steps by different people. A super admin registers one OAuth app per provider, either in **Admin → Integrations** or from the storage step itself when they hit a provider that is not set up yet; both open the same dialog, which is where the redirect address to copy lives. Until then that provider is not offered to anyone who cannot set it up. After that it appears in every workspace's storage options, and each workspace admin connects their own account from **Settings → Storage**: they sign in as themselves, the refresh token is encrypted against their workspace, and their models go to their own account. Nobody shares a connection, and a workspace admin never needs a developer console.

STL Quest keeps each workspace in a separate folder or path below the storage location you choose. OAuth client secrets and refresh tokens are encrypted with `/data/integration-secrets.key`, or with `INTEGRATIONS_ENCRYPTION_KEY` when you set it.

Super admins control whether local folders are available deployment-wide under **Super Admin → Integrations**. Local folders are enabled by default on self-hosted deployments and disabled by default when `STLQUEST_HOSTED=true`. When disabled, workspaces can still read existing local files so an administrator can migrate them, but they cannot browse server folders, select a new local folder, or upload new files until they switch to remote storage.

## First run

A new workspace chooses storage before its board opens. Self-hosted installations can accept the server's own folder, the `PRINTS_DIR` volume, in one click. Hosted deployments with managed storage configured offer it as the recommended option without exposing deployment credentials. The other providers state what you need in hand, so you can pick one you are able to finish in the moment and switch later.

## Managed hosted storage

Operators can configure an S3-compatible bucket with the `STLQUEST_HOSTED_STORAGE_*` environment variables described in the [deployment guide](deployment.md). Each workspace stores only `{ "adapter": "managed" }`; credentials remain in the server environment and objects are isolated below `workspaces/<workspace-id>/`.

Managed workspaces receive a fixed 1 GiB allowance shared by original models, previews, thumbnails, optimized assets, and recoverable trash. Incomplete uploads reserve capacity and are limited to three per user with the normal upload expiry policy. Deleting assets releases their capacity. An account can use the free managed allowance for one workspace while owning additional workspaces backed by its own storage, and can still join other workspaces by invitation.

## Dropbox

A super admin creates a scoped app with **App folder** access (not Full Dropbox) at the Dropbox App Console — STL Quest only ever sees its own `Apps/<your app>` folder. Dropbox labels the credentials "App key" and "App secret"; they map to STL Quest's client ID and secret fields. Grant the `account_info.read`, `files.metadata.read`, `files.content.read`, and `files.content.write` scopes; STL Quest probes the connection with a test file and reports any missing scope.

## Google Drive

A super admin enables the **Google Drive API** in Google Cloud Console and configure the OAuth consent screen. Then create a **Web application** OAuth client. STL Quest requests only the `drive.file` permission, which allows access to files and folders it creates in its own `STL Quest` folder, not the rest of the Drive. Google classifies this permission as non-sensitive, so app verification is not required. A self-hosted installation may still show an "unverified app" warning the first time you connect.

## OneDrive

A super admin registers a web application in Microsoft Entra and creates a client secret. STL Quest signs in through the `/common` endpoint, so set **Supported account types** to "Accounts in any organizational directory and personal Microsoft accounts". Registrations limited to one organization will reject sign-ins. Add `User.Read`, `Files.ReadWrite`, and `offline_access` as **delegated** Microsoft Graph permissions, not application permissions. Files live in OneDrive's dedicated `Apps/<your app>` folder. Refresh tokens rotate automatically; no action is needed when that happens.

## Remote folders over WebDAV

WebDAV keeps files as ordinary files and folders on a machine or NAS you control. STL Quest stores uploaded models in `models` and generated previews below `.stlquest`. Model paths stay fixed when requests move across the board, so workflow changes do not depend on the storage server. You can inspect or copy these files directly, but renaming or deleting files that STL Quest still references will make those assets unavailable.

Follow the [WebDAV setup guide](webdav.md) to configure a server, expose it through Cloudflare Tunnel or Tailscale Funnel, account for large-file limits, and connect it securely to STL Quest.

## S3-compatible services

STL Quest includes presets for Amazon S3, Backblaze B2, Cloudflare R2, DigitalOcean Spaces, and Google Cloud Storage with HMAC keys. It builds the service address from the region or account ID.

For MinIO, Wasabi, NAS gateways, and other compatible services, choose **Custom S3-compatible**. This option uses path-style addresses by default because many self-hosted services require them. Only the custom provider shows the path-style setting.

## Local folders

Folder paths are inside the STL Quest server or container, not the host — mount a host directory first (for example `-v /path/to/prints:/prints`), then pick it in the folder browser. STL Quest adds a private workspace directory below the selected folder.

## Switching providers

When you change storage, STL Quest pauses file changes, copies every file it knows about, verifies the copies, and then switches to the new provider. You can cancel or retry the migration. The original files remain in place; remove them manually after you have confirmed that the new storage works.
