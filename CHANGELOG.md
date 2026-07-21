# Changelog

## 0.30.0

### Minor Changes

- fb2d9bd: Redesign the app around a shop-floor visual identity — request cards render as job tickets, board columns as stations, so the queue reads like a print farm's paper trail instead of a generic kanban board.

## 0.29.1

### Patch Changes

- a83ac29: Show the most recently finished prints first in Ready, using requester priority only when completion times match.

## 0.29.0

### Minor Changes

- a1bd384: Select multiple board requests to move their instances atomically or delete them together.

## 0.28.1

### Patch Changes

- 27d294f: Preserve requester priority when moving prints between production stages so that drop position never changes queue order.
- f5904b9: Generate preview assets for model files up to 1 GiB and prioritize smaller queued models so that they receive thumbnails and dimensions sooner.

## 0.28.0

### Minor Changes

- 2581399: Notify everyone when PrintHub needs a browser refresh and alert super admins when a newer release is available.

## 0.27.3

### Patch Changes

- 22fcb05: Harden account bootstrap, workspace isolation, cloud storage recovery, and asset generation while adding keyboard board controls and retryable loading errors.
- 9b3edb7: Limit hosted local storage to super admin workspaces, separate Admin and Super admin roles, and add remote WebDAV folders for storage on user-owned hardware.

## 0.27.2

### Patch Changes

- aa76449: Keep board sorting and filters within the available screen space and remove ambiguous large and small order sorting choices.

## 0.27.1

### Patch Changes

- bbfe014: Restore role-aware requester priority and round-robin queue sorting so that workspace owners can choose how requesters share the queue.

## 0.27.0

### Minor Changes

- b06b75a: Add a visually distinct Up next production stage so that upcoming prints can be prepared while another job is printing.

## 0.26.1

### Patch Changes

- fc9ab56: Keep modal buttons stable when scrollbars appear on Windows.

## 0.26.0

### Minor Changes

- f654710: Add missing resin printers from Open Resin Alliance definitions so that the catalog includes newer models with transparent artwork.

## 0.25.1

### Patch Changes

- 9a52144: Show human-readable labels for selected requesters and configuration options instead of their stored values.

## 0.25.0

### Minor Changes

- 351a2cb: Focus PrintHub on fair queue ordering and capacity-aware printer assignment that only selects printers whose build volume can fit the model, so that slicers remain responsible for build preparation.

## 0.24.0

### Minor Changes

- 786b515: Add a synchronized catalog of predefined resin and filament printers with searchable build dimensions and available model images.

## 0.23.3

### Patch Changes

- ab802b8: Restore model previews on build plates after compressed preview generation.

## 0.23.2

### Patch Changes

- 8e902c6: Allow compressed model previews to load under the production security policy.

## 0.23.1

### Patch Changes

- da95319: Preserve more model detail in compressed previews without increasing their size.

## 0.23.0

### Minor Changes

- 6a178af: Choose between editable DragonFruit VOXL scenes and 3MF plate exports from one export menu.

## 0.22.0

### Minor Changes

- fb0caa6: Add bulk actions to plan or delete selected queued models.

### Patch Changes

- 2c8f2a9: Expand the build plate planner across the available screen and taller viewports, align board gutters, keep plate height independent from the contents sidebar, and simplify board loading states.

## 0.21.5

### Patch Changes

- a7bcb34: Improve build plate utilization across every planning strategy, guarantee maximum utilization selects the fewest generated layout, and tighten resin footprints using their minimum-area in-plane orientation.

## 0.21.4

### Patch Changes

- 15e6e42: Preload active workspace session data during server rendering so route navigation does not suspend.

## 0.21.3

### Patch Changes

- 6d9d2a4: Give each requester an independent priority list and let admins choose weighted balanced, user-priority, oldest-first, utilization, or tallest-first plate planning.

## 0.21.2

### Patch Changes

- 4b8501e: Choose the available print material automatically when adding prints.

## 0.21.1

### Patch Changes

- 84e8144: Show account creation errors returned by the authentication API and reduce the minimum password length to eight characters.

## 0.21.0

### Minor Changes

- cc97ee8: Add isolated workspaces with per-workspace members, boards, planners, settings, storage, invitations, and session-backed switching that preserves the current URL.

## 0.20.0

### Minor Changes

- 28062bb: Add OAuth-connected Dropbox, Google Drive, and OneDrive storage with guided setup, encrypted refresh tokens, resumable uploads, and background migration support.

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
