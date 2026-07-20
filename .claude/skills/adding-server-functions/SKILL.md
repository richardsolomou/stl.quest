---
name: adding-server-functions
description: Add or modify a TanStack Start server function — guards, the rpc() wrapper, CSRF, workspace scoping, and client query/mutation wiring. Use when adding an API surface or changing src/server/fns.ts.
---

# Adding server functions

The pattern in `src/server/fns.ts`:

```ts
export const doThing = createServerFn({ method: 'POST' })
  .validator(thingSchema)
  .handler(({ data }) => rpc(async () => { ... }))
```

Rules, in order of how often they get missed:

1. Wrap the handler body in `rpc()`. Thrown `Response` objects (`PrintHubService` throws 400/403/404/409 constantly) otherwise reach the client as a _successful_ result instead of an error.
2. Mutations (`method: 'POST'`) call `requireMutationOrigin()` before touching state. CSRF protection is per-function, not middleware — copy-pasting a GET handler is how it gets dropped.
3. Guards: `me(instance)` for any signed-in user, `admin(instance)` for super admins, `workspaceContext`/`workspaceAdmin` for workspace work. These are the real authorization; route-level redirects are UX only.
4. Workspace-scoped functions take `workspaceSlug` via `inWorkspace(schema)` and resolve everything through `workspaceContext` — never construct repositories or services directly.
5. Validation schemas live in `src/server/schemas.ts`; shared types in `src/core/types.ts`.
6. Mutations go through `PrintHubService` (which publishes the typed `AppEvent` and captures telemetry), not the repository.
7. If a settings change affects app wiring (auth providers, SMTP, storage), call `resetApp()` after persisting; SSE clients reconnect via the event-bus close signal.

Client wiring:

- Queries: add a `queryOptions` factory to `src/client/queries.ts`; workspace-scoped keys must include `workspaceSlug` or data leaks across workspace switches.
- Mutations: `useServerFn(fn)` as the `mutationFn` in `useMutation`. Invalidation is blanket — the global `/api/events` SSE listener invalidates all queries on any change — so no bespoke invalidation is needed.

Tests are colocated (`src/server/fns.test.ts`); test through the public surface, not internals.
