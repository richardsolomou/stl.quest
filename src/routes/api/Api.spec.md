# Api

HTTP endpoints for uploads, files, auth, health, and realtime tokens.

## entrances

- GET /api/auth/$: HTTP request reaches this route handler.
  handler: Route in auth.$.ts
  trust: network
- POST /api/auth/$: HTTP request reaches this route handler.
  handler: Route in auth.$.ts
  trust: network
- GET /api/files/$requestId: HTTP request reaches this route handler.
  handler: Route in files.$requestId.ts
  trust: network
- GET /api/files/batch: HTTP request reaches this route handler.
  handler: Route in files.batch.ts
  trust: network
- GET /api/health: HTTP request reaches this route handler.
  handler: Route in health.ts
  trust: network
- GET /api/source-images/$requestId: HTTP request reaches this route handler.
  handler: Route in source-images.$requestId.ts
  trust: network
- GET /api/thumbs/$requestId: HTTP request reaches this route handler.
  handler: Route in thumbs.$requestId.ts
  trust: network
- POST /api/upload/$: HTTP request reaches this route handler.
  handler: Route in upload.$.ts
  trust: network
- PATCH /api/upload/$: HTTP request reaches this route handler.
  handler: Route in upload.$.ts
  trust: network
- DELETE /api/upload/$: HTTP request reaches this route handler.
  handler: Route in upload.$.ts
  trust: network
- HEAD /api/upload/$: HTTP request reaches this route handler.
  handler: Route in upload.$.ts
  trust: network
- OPTIONS /api/upload/$: HTTP request reaches this route handler.
  handler: Route in upload.$.ts
  trust: network

## invariants
