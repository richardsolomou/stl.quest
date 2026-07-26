---
name: adding-server-functions
description: Add or modify a TanStack Start server function — guards, the rpc() wrapper, CSRF, workspace scoping, and client query/mutation wiring. Use when adding an API surface or changing src/server/fns.ts.
---

# Adding server functions

Read [Server functions](../../../docs/development/server-functions.md) before changing code. That guide is the source of truth for authorization, `rpc()`, mutation-origin checks, workspace scoping, and client wiring.

Workflow:

1. Add the schema and server function using the documented pattern.
2. Verify authorization, workspace isolation, and mutation-origin protection.
3. Wire the client query or mutation.
4. Add colocated public-surface tests.
5. Run `pnpm check`.
