# Routes

Browser and HTTP route handlers.

## entrances

- page /about: browser navigation opens this page.
  handler: Route in about.tsx
  trust: network
- page /account: browser navigation opens this page.
  handler: Route in account.tsx
  trust: network
- page /admin/$section: browser navigation opens this page.
  handler: Route in admin.$section.tsx
  trust: network
- GET /api/storage/box/callback: HTTP request reaches this route handler.
  handler: Route in api.storage.box.callback.ts
  trust: provider-response
- GET /api/storage/dropbox/callback: HTTP request reaches this route handler.
  handler: Route in api.storage.dropbox.callback.ts
  trust: provider-response
- GET /api/storage/google-drive/callback: HTTP request reaches this route handler.
  handler: Route in api.storage.google-drive.callback.ts
  trust: provider-response
- GET /api/storage/onedrive/callback: HTTP request reaches this route handler.
  handler: Route in api.storage.onedrive.callback.ts
  trust: provider-response
- page /archive: browser navigation opens this page.
  handler: Route in archive.tsx
  trust: network
- page /calculator: browser navigation opens this page.
  handler: Route in calculator.tsx
  trust: network
- page /: browser navigation opens this page.
  handler: Route in index.tsx
  trust: network
- page /invite/$token: browser navigation opens this page.
  handler: Route in invite.$token.tsx
  trust: network
- page /plan: browser navigation opens this page.
  handler: Route in plan.tsx
  trust: network
- page /reset-password: browser navigation opens this page.
  handler: Route in reset-password.tsx
  trust: network
- page /settings/$section: browser navigation opens this page.
  handler: Route in settings.$section.tsx
  trust: network
- page /settings/: browser navigation opens this page.
  handler: Route in settings.index.tsx
  trust: network
- page /settings: browser navigation opens this page.
  handler: Route in settings.tsx
  trust: network

## invariants
