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

- asset routes enforce request visibility: Every asset HTTP handler hides another member's private request and another workspace's request.
  over: file, batch, thumbnail, and source-image GET handlers with owned, private, and foreign request ids; each batch includes an owned id
  via: asset routes enforce request visibility
  because: model bytes, thumbnails, source covers, and ZIPs must obey the same workspace and member visibility rules as the board.
  crossing: network -> workspace-state
  refuted: bypassed authorizedRequestAsset in the source-image handler -> the route visibility test failed before restore (2026-09-25)
  kinds: read, identity
  checklist: scoped-reads declared as asset routes enforce request visibility
  checklist: capability-authorization dismissed: these GET handlers use session identity and workspace scope, not a delegated credential.
  checklist: redaction dismissed: denied requests return no asset rather than a scrubbed representation.
  checklist: canonical-encoding dismissed: the handlers look up opaque request ids and do not encode an identity.
  checklist: identity-continuity dismissed: no principal change occurs during an asset read.
