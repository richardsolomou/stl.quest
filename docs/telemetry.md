# Telemetry

STL Quest sends anonymous usage data by default to help guide improvements. This page lists what is sent and what is not, so you can make an informed choice.

The setting applies to the whole installation. You can turn it off at any time under **Super Admin → Telemetry**. The change takes effect immediately and does not require a restart. When telemetry is off, STL Quest does not load the browser analytics library.

## What is sent

Events are sent through STL Quest's `/ingest` route to PostHog. They use a random internal user ID, never an email address, name, or other direct identifier. Authenticated users are classified by account role and whether they are a super admin. Server errors and storage migration results use the fixed ID `server`.

Server logs sent to PostHog include the severity, message, event, outcome, request ID, duration, and relevant structured details. Authenticated requests are linked to the same anonymous internal user and browser session used by product analytics. Passwords, tokens, authorization headers, cookies, asset filenames, and configured storage paths are removed before logs are written locally or sent remotely. Routine successful GET requests are retained locally at debug level but are not exported with the default production log level.

| Event                            | Property keys                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `request_created`                | `print_type`, `assignment_state`                                                       |
| `request_updated`                | `print_type`                                                                           |
| `request_copies_moved`           | `print_type`, `copy_count`, `from_status`, `to_status`, `operation`                    |
| `request_batch_moved`            | `request_count`, `copy_count`, `from_statuses`, `to_statuses`, `print_types`           |
| `request_copies_deleted`         | `print_type`, `copy_count`, `from_status`, `operation`                                 |
| `request_deleted`                | `print_type`, `copy_count`, `from_status` or `from_statuses`, `operation`              |
| `request_batch_deleted`          | `request_count`, `copy_count`, `deleted_request_count`, `from_statuses`, `print_types` |
| `request_reordered`              | `status`                                                                               |
| `requests_submitted`             | `file_count`, `print_types`                                                            |
| `request_viewed`                 | `print_type`                                                                           |
| `stl_downloaded`                 | `print_type`                                                                           |
| `stl_full_detail_requested`      | —                                                                                      |
| `upload_opened`                  | `source`, plus `file_count` for drag-and-drop                                          |
| `workspace_created`              | —                                                                                      |
| `workspace_switched`             | —                                                                                      |
| `workspace_deleted`              | —                                                                                      |
| `workspace_member_role_changed`  | `role`                                                                                 |
| `workspace_member_removed`       | —                                                                                      |
| `printer_saved`                  | `printer_count`                                                                        |
| `storage_configured`             | `adapter`                                                                              |
| `storage_migration_started`      | `from`, `to`                                                                           |
| `storage_migration_retried`      | `adapter`                                                                              |
| `storage_migration_cancelled`    | `adapter`, `files_copied`                                                              |
| `storage_migration_completed`    | `adapter`, `files`, `bytes`                                                            |
| `storage_migration_failed`       | `adapter`, `files_copied`                                                              |
| `cloud_storage_disconnected`     | `provider`                                                                             |
| `cloud_storage_connected`        | `provider`                                                                             |
| `board_visibility_changed`       | `private_requests`                                                                     |
| `print_group_created`            | `item_count`, `copy_count`                                                             |
| `print_group_renamed`            | —                                                                                      |
| `print_group_deleted`            | `item_count`, `copy_count`                                                             |
| `print_group_moved`              | `from_status`, `to_status`, `item_count`, `copy_count`                                 |
| `print_group_item_changed`       | `action`, `copy_count`                                                                 |
| `invite_created`                 | `role`, `emailed`                                                                      |
| `invite_revoked`                 | `role`, `emailed`                                                                      |
| `invite_accepted`                | —                                                                                      |
| `auth_provider_configured`       | `provider`, `enabled`                                                                  |
| `sign_in_method_added`           | `provider`                                                                             |
| `sign_in_method_removed`         | `provider`                                                                             |
| `account_email_change_requested` | —                                                                                      |
| `account_profile_updated`        | `name_changed`, `email_change_requested`                                               |
| `password_changed`               | `other_sessions_revoked`                                                               |
| `two_factor_enabled`             | —                                                                                      |
| `two_factor_disabled`            | —                                                                                      |
| `user_signed_in`                 | `auth_method`, `account_created`, `trusted_device`                                     |
| `user_signed_out`                | —                                                                                      |

`account_created` is only present for password sign-in; `trusted_device` is only present for two-factor sign-in.

Batch queue events are emitted once after the complete mutation succeeds. Their counts describe the whole operation; the existing per-request events remain available for print-type and transition analysis. The `operation` property distinguishes `single`, `batch`, and print-group movements.

STL Quest also records page navigation and the browser, operating system, and screen size reported by the PostHog library.

Session recordings capture page layout and interactions. Form inputs are masked, and requester names, email addresses, and profile images are excluded from recordings.

Error reports:

- Server-side exceptions use PostHog Error Tracking and can include the error message, stack trace, source file names and paths, and explicit structured context. Uncaught exceptions, unhandled promise rejections, and errors written through the server logger are captured.
- Browser-side exceptions use PostHog's exception capture, which can include the error message, stack trace, browser metadata, and in-app page URL. Explicit context keys are `action`, `print_type`, `from`, `to`, `count`, and `status` for board or request mutations; `action` and `file_size_bytes` for uploads; and `area` and `showing_preview` for the STL viewer. Unhandled render errors are captured by the application error boundary, and route failures are relayed through the server when the normal browser provider cannot mount.

## What is never sent

Events never include model files or geometry, request names or notes, file names, email addresses, user names, storage credentials, or other workspace content. Automatic interaction capture is disabled.

## Disabling telemetry

Open **Super Admin → Telemetry** and turn off **Share anonymous usage data**. This stops server events, remote server logs, and browser events for the whole installation.
