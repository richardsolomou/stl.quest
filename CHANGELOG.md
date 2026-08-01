# Changelog

## 1.20.0

### Minor Changes

- 9a969a6: Add hierarchical tags that stay attached to prints as they move through the board.

### Patch Changes

- aa2e126: Move card tag indicators outside the corner and show only each tag name in its tooltip.

## 1.19.0

### Minor Changes

- c23b227: Complete an interactive STL Quest across the app to learn workflows, earn XP, and celebrate your progress.

## 1.18.0

### Minor Changes

- a6f9f2c: Create a new print request from any existing card with Print again so that previous progress remains unchanged.

## 1.17.0

### Minor Changes

- 3aaf12e: Tell rate-limited and errored sign-ins apart from wrong passwords so that a stuck user is told to wait or points at their administrator instead of being repeatedly told their password is incorrect, and record anonymous sign-in-failure and password-reset-request telemetry.

## 1.16.0

### Minor Changes

- d19bf12: Select cards across multiple board columns so that you can download, move, or delete them together.

## 1.15.2

### Patch Changes

- 0029897: Allow selecting and moving multiple prints within a print group.

## 1.15.1

### Patch Changes

- e9029f4: Move all copies when dragging a stack between board stages or group boundaries, or hold Alt or Option to choose how many to move.

## 1.15.0

### Minor Changes

- 4b9d474: Move a chosen number of queued copies from print details, and download one or many selected STLs from the board menu.

## 1.14.9

### Patch Changes

- 93ad4aa: Close print deletion confirmations immediately while the deletion completes in the background.

## 1.14.8

### Patch Changes

- 69e67d7: Return a handled 409 when an admin lowers a request's quantity below the copies already in progress, so the reason shows in the editor instead of surfacing as a server error and filing duplicate error-tracking issues.

## 1.14.7

### Patch Changes

- dd2bf47: Report workflow telemetry per completed operation so that queue, upload, download, printer, and storage usage is measured accurately.

## 1.14.6

### Patch Changes

- 4af8a6d: Allow an owner to create multiple workspaces with the same display name.
- a96769c: Clarify that included model storage comes from the account plan and is shared across all workspaces.
- d4fef1b: Open the board after creating or switching workspaces so that each workspace starts from a consistent view.

## 1.14.5

### Patch Changes

- 43af646: Keep a workspace bootable when its storage recovery lease cannot be acquired, degrading to the storage-not-ready state and retrying later instead of failing the whole workspace runtime.

## 1.14.4

### Patch Changes

- a55c98b: Hide disabled password, Google, and Discord methods from authentication forms immediately after their settings change.

## 1.14.3

### Patch Changes

- bc14b57: Stop reporting the STL viewer's in-flight model download as an error when it is aborted by navigating away, reloading, or closing the request modal, so that a benign browser-initiated abort no longer pollutes error tracking.

## 1.14.2

### Patch Changes

- f8c0c76: Keep included storage available while upgrading workspaces with more than 100 stored entries.

## 1.14.1

### Patch Changes

- ce3e4f6: Delete a request whose cloud storage file has already been removed instead of failing the board action, so that a file that vanishes mid-delete no longer surfaces an error.

## 1.14.0

### Minor Changes

- 5f4801a: Create and migrate cloud workspace folders automatically, placing generated asset folders beside models so that storage is easier to browse.

## 1.13.2

### Patch Changes

- 638677a: Disable a configured cloud storage provider without removing its credentials so that unavailable integrations can be taken out of service safely.

## 1.13.1

### Patch Changes

- dd398b5: Return to the selected cloud storage provider after connecting an account so that you can finish choosing its folder.

## 1.13.0

### Minor Changes

- cc09b09: Connect Box storage so that workspaces can keep models in their Box account.

## 1.12.0

### Minor Changes

- 3ae312e: Show what your plan is actually doing on the account page: when it renews or ends, and how the shared storage allowance is split across your workspaces.

### Patch Changes

- 98ad692: Clarify OAuth setup, show public HTTPS callback URLs behind proxies, require social providers to be retested after credential changes, and derive local-folder availability from the deployment mode.

## 1.11.4

### Patch Changes

- c63f0fe: Stop reporting an over-quota storage migration as an application error, so an expected "you're over your storage quota" failure no longer opens a new error-tracking issue each time.

## 1.11.3

### Patch Changes

- e99de3a: Skip payment method collection when a coupon makes checkout free.

## 1.11.2

### Patch Changes

- 6cbd373: Recover from a stalled model load in the request viewer, so a slow file read shows a retryable error instead of leaving the modal stuck on "loading model…".

## 1.11.1

### Patch Changes

- 36bd39d: Accept promotion codes at checkout, so a discount code you've been given can actually be entered before you pay.

## 1.11.0

### Minor Changes

- 2c8ca52: Offer a plan upgrade from the storage indicator and from uploads that run out of room, and link the plan from the account menu, so hitting a storage limit no longer means hunting for where to fix it.

## 1.10.1

### Patch Changes

- 012391a: Allow Stripe Checkout to create pending subscriptions without supplying timestamps.

## 1.10.0

### Minor Changes

- e3dfcc0: Add hosted Supporter and Pro storage plans with Stripe Managed Payments so accounts can keep uploading as their libraries grow.

## 1.9.4

### Patch Changes

- 6688b83: Keep deleted copies off the board when live updates skip an intermediate move state.

## 1.9.3

### Patch Changes

- 358aa12: Tell operators that a storage migration onto managed hosted storage failed because it would exceed the storage quota, so that they know to free up space or raise the quota and retry.

## 1.9.2

### Patch Changes

- 4cca887: Refresh storage across every app instance immediately after workspace storage changes.

## 1.9.1

### Patch Changes

- 77794c9: Show the actual storage failure when a migration cannot copy a file.

## 1.9.0

### Minor Changes

- b943008: Show account dates, recent activity, and workspace counts in a configurable admin users table.

## 1.8.0

### Minor Changes

- 190ef8b: Offer hosted accounts 1 GB of included storage shared across three owned workspaces so that users can start uploading without configuring a provider.

## 1.7.3

### Patch Changes

- c959ed6: Show a loading indicator while each model thumbnail is waiting for storage.

## 1.7.2

### Patch Changes

- 548e6a6: Keep remote models, previews, and thumbnails loading when storage connections are slow or briefly unavailable.

## 1.7.1

### Patch Changes

- 5df7730: Stop creating anonymous app volumes so that distributed deployments can run without `/data` or `/prints` mounts.

## 1.7.0

### Minor Changes

- ce6bd8b: Add a PostgreSQL, Redis-compatible, and S3-backed distributed mode for multi-replica cloud deployments.

## 1.6.4

### Patch Changes

- 98bf1df: Keep deployments healthy when workspace storage is unavailable so that an offline remote server cannot block an upgrade.
- 18b502d: Let super admins control whether workspaces can use local folder storage.

## 1.6.3

### Patch Changes

- e8a588b: Prevent WebDAV trash cleanup timeouts and expected database migration notices during startup.

## 1.6.2

### Patch Changes

- e4bae65: Improve storage migrations with partial WebDAV transfers, actionable limit errors, and clear paused-upload guidance.
- e4bae65: Standardize the default self-hosted web interface port on 30455 across Docker, TrueNAS, and Unraid.

## 1.6.1

### Patch Changes

- de8b63b: Show sign-in methods and two-factor authentication as the same kind of row used everywhere else in settings, each with a badge stating its real state.
- de8b63b: Spell out what deleting prints, changing your password, removing a member, and turning off two-factor authentication actually do, so the consequence is visible before you confirm rather than after.
- de8b63b: Say what went wrong when creating a workspace, deleting a print group, or opening a server folder that cannot be read, each of which used to fail with no explanation at all.
- de8b63b: Report a failed setting, upload, or board action in the view that caused it, naming what to check before the server's own wording, instead of a toast that disappears before it can be read.

## 1.6.0

### Minor Changes

- 39f5bb6: Connect your own Dropbox, Google Drive, or OneDrive account to a workspace, so that models land in storage the workspace owner controls instead of a single account shared across the deployment. A super admin registers each provider's app once, from Integrations or from storage setup itself, and only providers they have set up are offered. Any connection already in use moves to the workspace using it.
- 39f5bb6: Go back to the storage step from the printer step during setup and switch provider, or keep the location already saved, so that a storage choice made early is not final.
- 39f5bb6: Choose storage from a guided picker that recommends this server's folder as a one-click option and says what every other provider needs before you commit to it, so that first-run setup finishes before it starts feeling like work.

### Patch Changes

- 39f5bb6: Group each storage form into labelled sections with the hints and examples every field was missing, and show the exact destination the settings add up to, so that connecting storage takes less guesswork.
- 39f5bb6: Read every deployment integration as one list of rows with its current state, and set each one up through a dialog that shows the steps, the addresses to copy, and any failure in place.
- 39f5bb6: Set up every workspace through the same two steps named after that workspace, instead of a new account landing on "step 3 of 4" of a sequence that counted screens it had already passed.
- 39f5bb6: Decide what happens to files already in a storage location through one dialog that names the consequence of each choice and asks you to acknowledge a deletion, so that switching storage no longer hides the irreversible option behind a second prompt.
- 39f5bb6: Present the printer setup step like the storage step, opening with the preset catalogue, marking models already in your list, and reporting a failed save in place.
- 39f5bb6: Remember that printer setup was skipped, so reloading the board no longer drops you back into the printer step.
- 39f5bb6: Report storage problems in the form itself, leading with what to check for that provider and keeping the server's own message as a detail line.

## 1.5.7

### Patch Changes

- de9774a: Allow navigating away during storage migrations and automatically retry transient storage failures.

## 1.5.6

### Patch Changes

- 586012e: Retry transient gateway errors from WebDAV and other non-S3 storage backends during a migration, so a temporary 502 no longer aborts the whole run.

## 1.5.5

### Patch Changes

- 22ec856: Persist completed storage migrations, test destinations before switching, and review whether to keep or replace all contents in the selected folder.

## 1.5.4

### Patch Changes

- 2371a91: Let workspaces with unavailable storage load into recovery guidance and report route failures to Error Tracking.

## 1.5.3

### Patch Changes

- aed4454: Improve anonymous production diagnostics while preventing filenames and filesystem paths from appearing in server logs.
- 441319d: Report unexpected server errors and replace empty failure details with recovery guidance.

## 1.5.2

### Patch Changes

- 025abd7: Delete and move print cards cleanly when the model file is already missing from storage, instead of surfacing a raw server error in the browser.

## 1.5.1

### Patch Changes

- 89559a3: Report workspace membership and print group changes in anonymous telemetry so that product health monitoring covers more administrative workflows.

## 1.5.0

### Minor Changes

- 5a572ce: Record privacy-protected sessions so that usability problems can be diagnosed without exposing requester identities.

### Patch Changes

- eaa5b96: Remove deleted requests from the queue immediately so that slow storage cleanup does not block the interface.

## 1.4.1

### Patch Changes

- 8ecba24: Use one consistent tagline across the app and deployment listings.

## 1.4.0

### Minor Changes

- 229b1e8: Choose PostgreSQL at deployment time so that hosted installations can use a scalable database service.

## 1.3.1

### Patch Changes

- 017ffa0: Move every selected request when dragging the selection into a print group.

## 1.3.0

### Minor Changes

- 77d12f1: Give print groups persistent colors and collapsible contents so that busy boards are easier to scan.

### Patch Changes

- 8ec476d: Render every STL model in the same visible grey regardless of embedded facet colors or invalid normals.

## 1.2.0

### Minor Changes

- cfd58d6: Group prepared prints so that an entire plate can move through production together.

## 1.1.22

### Patch Changes

- 09b96f2: Select, move, or delete card copies from context menus on any device without affecting copies in other stages.

## 1.1.21

### Patch Changes

- c84b252: Show requester avatars and live board presence to everyone when request visibility is shared.

## 1.1.20

### Patch Changes

- 2b87f30: Show each requester’s avatar on queue cards instead of repeating their name.

## 1.1.19

### Patch Changes

- dcf3156: Make repeated request deletions complete quietly so that fast duplicate clicks do not show an error.

## 1.1.18

### Patch Changes

- 40492ae: Keep uploaded models at stable paths so that board moves remain fast and reliable across every storage provider.

## 1.1.17

### Patch Changes

- 277c9d5: Move files reliably through proxied WebDAV servers so that TrueNAS storage works behind Cloudflare Tunnel without custom proxy rules.

## 1.1.16

### Patch Changes

- 9fce1fc: Allow printers to be added during onboarding from non-secure local network addresses.

## 1.1.15

### Patch Changes

- 3b943a8: Allow moving a request between columns when it already has copies in the destination.

## 1.1.14

### Patch Changes

- 4178f9d: Keep replacement sessions active when impersonating users over HTTPS.
- 67750b6: Keep authentication cookies secure and user impersonation active on HTTPS deployments.

## 1.1.13

### Patch Changes

- 1890e94: Prevent production builds from serving pages without the application stylesheet.

## 1.1.12

### Patch Changes

- 04750f6: Load the application stylesheet reliably after deployments so that refreshed pages do not briefly appear unstyled.

## 1.1.11

### Patch Changes

- 5827c72: Create a personal workspace only when a user signs in without any existing workspace memberships.
- 0b5463b: Blur email addresses until clicked so that private details stay hidden during screen sharing.

## 1.1.10

### Patch Changes

- ede3915: Keep authenticated saves working through HTTPS proxies and display mutation failures so that actions never fail silently.

## 1.1.9

### Patch Changes

- 6d54b47: Allow hosted deployments to start without explicitly configuring an authentication URL.

## 1.1.8

### Patch Changes

- b038f33: Keep signed-in sessions active behind HTTPS proxies so that authentication completes successfully.

## 1.1.7

### Patch Changes

- 0a03c63: Fix two-factor and social sign-in requests behind HTTPS reverse proxies.
- ed9fc4a: Capture account security, board visibility, and storage administration activity in anonymous product analytics.

## 1.1.6

### Patch Changes

- cc0f2b9: Capture unexpected server errors and structured logs in PostHog so that production failures can be diagnosed.

## 1.1.5

### Patch Changes

- c0018f1: Allow sign-in over direct HTTP connections used by local TrueNAS and other self-hosted installations.

## 1.1.4

### Patch Changes

- c75a3ef: Run Unraid installations as the standard Unraid user so that mounted app data and print folders are writable.

## 1.1.3

### Patch Changes

- 04804f3: Fix TrueNAS and Unraid deployments so that they pull the renamed STL Quest container image.

## 1.1.2

### Patch Changes

- beec819: Improve update notifications, GitHub links, and Cloudflare Tunnel guidance for a less disruptive administration and storage setup experience.

## 1.1.1

### Patch Changes

- 21d8711: Preserve access to existing print files after upgrading to workspace storage.
- 25dfd50: Move upgraded installations into workspace-isolated storage automatically on startup.

## 1.1.0

### Minor Changes

- 71812cc: Show workspace admins who is actively viewing the board with live avatar indicators and name tooltips.
- f464a3f: Manage your profile, email address, and linked sign-in methods from the account page so that you can choose how you access STL Quest.

## 1.0.1

### Patch Changes

- 1913490: Simplify startup and configuration handling around STL Quest storage, settings, and previews.

## 1.0.0

### Major Changes

- 15b5fcf: Rename the product to STL Quest, make stl.quest its canonical home, migrate existing database, workspace, local assets, and lease files, and adopt the AGPLv3 license.

## 0.31.0

### Minor Changes

- e959853: Let users explore PrintHub before completing storage and printer setup, while keeping uploads disabled until storage is ready.

## 0.30.1

### Patch Changes

- d614c1f: Refresh the browser favicon after PrintHub upgrades so that updated branding appears without clearing the browser cache.

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

## [0.17.0](https://github.com/richardsolomou/stl.quest/compare/v0.16.0...v0.17.0) (2026-07-13)

### Features

- **planner:** detect pre-supported models ([#15](https://github.com/richardsolomou/stl.quest/issues/15)) ([876867b](https://github.com/richardsolomou/stl.quest/commit/876867b5ac025d540c194020944d73bda73324ac))
- **planner:** export build plates as 3MF ([#17](https://github.com/richardsolomou/stl.quest/issues/17)) ([380a46e](https://github.com/richardsolomou/stl.quest/commit/380a46ec54a53eeec4b860187e8d57db7e9c60fa))

### Bug Fixes

- **ci:** ignore generated changelog formatting ([#18](https://github.com/richardsolomou/stl.quest/issues/18)) ([a3f7592](https://github.com/richardsolomou/stl.quest/commit/a3f7592c0d6d99510a62970025b63a31a3c54474))
