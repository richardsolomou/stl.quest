# Changelog

## 0.19.1

### Patch Changes

- f98fe00: Keep board cards in their original position when they are dropped on invalid blank space in the same column.

## 0.19.0

### Minor Changes

- 7ead084: Let administrators migrate files between local and S3-compatible storage with guided setup, resumable progress, verification, and cancellation.

## 0.18.0

### Minor Changes

- d4529b7: Add optional authenticator-based two-factor authentication with recovery codes and trusted devices.
- d4529b7: Allocate print copies across compatible printers and show each printer's planned plates without exposing printer targeting to requesters.
- d4529b7: Make printer assignment the source of truth for resin and filament requests, with compatible printer pools, technology-specific material estimates, mixed-fleet planning, and safer printer changes.
- d4529b7: Add guided onboarding, resin-focused production stages, printer assignment, planner filters, automatic model orientation, and clearer self-hosted positioning.
- d4529b7: Let administrators impersonate users for one hour with a persistent control to exit the impersonated session.

### Patch Changes

- d4529b7: Move request ownership and database migrations to Drizzle so profile changes and duplicate names cannot break authorization.

## [0.17.0](https://github.com/richardsolomou/printhub/compare/v0.16.0...v0.17.0) (2026-07-13)

### Features

- **planner:** detect pre-supported models ([#15](https://github.com/richardsolomou/printhub/issues/15)) ([876867b](https://github.com/richardsolomou/printhub/commit/876867b5ac025d540c194020944d73bda73324ac))
- **planner:** export build plates as 3MF ([#17](https://github.com/richardsolomou/printhub/issues/17)) ([380a46e](https://github.com/richardsolomou/printhub/commit/380a46ec54a53eeec4b860187e8d57db7e9c60fa))

### Bug Fixes

- **ci:** ignore generated changelog formatting ([#18](https://github.com/richardsolomou/printhub/issues/18)) ([a3f7592](https://github.com/richardsolomou/printhub/commit/a3f7592c0d6d99510a62970025b63a31a3c54474))
