# Server functions

Server functions in `src/server/fns.ts` are the application's authorization boundary. Route redirects improve the user experience but do not enforce access.

Follow this shape:

```ts
export const doThing = createServerFn({ method: 'POST' })
  .validator(thingSchema)
  .handler(({ data }) => rpc(async () => { ... }))
```

## Required behavior

1. Wrap every handler body in `rpc()`. Without it, a `Response` thrown by `STLQuestService` for a 400, 403, 404, or 409 error reaches the client as a successful result.
2. For every mutation (`method: 'POST'`), call `requireMutationOrigin()` before changing state. Each function provides its own cross-site request forgery protection; there is no middleware fallback.
3. Use `me(instance)` for any signed-in user, `superAdmin(instance)` for super admins, and `workspaceContext` or `workspaceAdmin` for workspace actions.
4. Workspace functions take `workspaceSlug` through `inWorkspace(schema)` and resolve data through `workspaceContext`. Do not construct repositories or services directly.
5. Put validation schemas in `src/server/schemas.ts` and shared types in `src/core/types.ts`.
6. Send mutations through `STLQuestService`, not directly to the repository. The service publishes the typed `AppEvent` and records telemetry.
7. If a settings change affects services created during application startup, call `resetApp()` after saving it. Realtime clients reconnect automatically.

## Client wiring

Add query factories to `src/client/queries.ts`. Include `workspaceSlug` in every workspace query key so cached data cannot appear after switching workspaces.

For mutations, pass `useServerFn(fn)` as the `mutationFn` in `useMutation`. The workspace Centrifugo channel invalidates all queries after a change, so do not add function-specific invalidation.

Tests are colocated in `src/server/fns.test.ts`. Test through the public server-function surface rather than implementation details.
