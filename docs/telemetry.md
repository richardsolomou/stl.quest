# Telemetry

PrintHub sends anonymous usage telemetry by default to help improve the app. This page lists exactly what is sent so you can decide whether to keep it enabled. Telemetry is deployment-wide and can be turned off at any time in the Super Admin area's Telemetry tab — the toggle applies immediately without a restart, and while disabled the browser analytics library is never loaded at all.

## What is sent

Events go through the app's own `/ingest` route, which reverse-proxies to PostHog. Events are keyed by the internal, randomly generated user ID — never an email address, name, or other profile data. Server-side error reports and storage migration outcomes use the fixed identifier `server`.

| Event                         | Property keys                                          |
| ----------------------------- | ------------------------------------------------------ |
| `request_created`             | `print_type`, `assignment_state`                       |
| `request_updated`             | `print_type`                                           |
| `request_copies_moved`        | `print_type`, `copy_count`, `from_status`, `to_status` |
| `request_deleted`             | `print_type`                                           |
| `requests_submitted`          | `file_count`, `print_types`                            |
| `request_viewed`              | `print_type`                                           |
| `stl_downloaded`              | `print_type`                                           |
| `stl_full_detail_requested`   | —                                                      |
| `upload_opened`               | `source`, plus `file_count` for drag-and-drop          |
| `workspace_created`           | —                                                      |
| `workspace_switched`          | —                                                      |
| `workspace_deleted`           | —                                                      |
| `printer_saved`               | `printer_count`                                        |
| `storage_configured`          | `adapter`                                              |
| `storage_migration_completed` | `adapter`, `files`, `bytes`                            |
| `storage_migration_failed`    | `adapter`, `files_copied`                              |
| `invite_created`              | `role`, `emailed`                                      |
| `invite_accepted`             | —                                                      |
| `auth_provider_configured`    | `provider`, `enabled`                                  |
| `user_signed_in`              | `auth_method`, `account_created`, `trusted_device`     |
| `user_signed_out`             | —                                                      |

`account_created` is only present for password sign-in; `trusted_device` is only present for two-factor sign-in.

Page navigation within the app is also captured, along with the standard analytics metadata the PostHog library attaches (browser, operating system, screen size).

Error reports:

- Server-side asset errors send the error message only — no stack trace, file names, or paths — with `action` (`assets_read`, `assets_write`, or `assets_generate`) and `print_type`.
- Browser-side exceptions use PostHog's exception capture, which can include the error message, stack trace, browser metadata, and in-app page URL. Explicit context keys are `action`, `print_type`, `from`, `to`, `count`, and `status` for board or request mutations; `action` and `file_size_bytes` for uploads; and `area` and `showing_preview` for the STL viewer. Unhandled render errors are also captured by the application error boundary.

## What is never sent

Model files and geometry, request names and notes, file names, email addresses, user names, storage credentials, and workspace content are never included in any event. Interaction autocapture and session recording are explicitly disabled.

## Disabling telemetry

Open the Super Admin area's Telemetry tab and turn off "Share anonymous usage data". The setting is stored deployment-wide and gates both server and browser events.
