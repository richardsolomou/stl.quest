# Telemetry

PrintHub sends anonymous usage telemetry by default to help improve the app. This page lists exactly what is sent so you can decide whether to keep it enabled. Telemetry is deployment-wide and can be turned off at any time in the Admin area's Telemetry tab — the toggle applies immediately without a restart, and while disabled the browser analytics library is never loaded at all.

## What is sent

Events go to the project's telemetry relay (`t.ras.sh`), which forwards them to PostHog. Events are keyed by the internal, randomly generated user ID — never an email address, name, or other profile data. Server-side error reports use the fixed identifier `server`.

| Event                       | Properties                                      |
| --------------------------- | ----------------------------------------------- |
| `request_created`           | print type, whether a printer was assigned      |
| `request_updated`           | print type                                      |
| `request_copies_moved`      | print type, copy count, from/to workflow status |
| `request_deleted`           | print type                                      |
| `requests_submitted`        | file count, print types                         |
| `request_viewed`            | print type                                      |
| `stl_downloaded`            | print type                                      |
| `stl_full_detail_requested` | —                                               |
| `upload_opened`             | source (button or drag-and-drop), file count    |

Page navigation within the app is also captured, along with the standard analytics metadata the PostHog library attaches (browser, operating system, screen size).

Error reports:

- Server-side errors send the error message only — no stack trace, file names, or paths — tagged with the failing action (asset read, write, or generate) and print type.
- Browser-side errors send the error message, stack trace, and the in-app page URL, tagged with the failing action.

## What is never sent

Model files and geometry, request names and notes, file names, email addresses, user names, storage credentials, and workspace content are never included in any event. Interaction autocapture and session recording are explicitly disabled.

## Disabling telemetry

Open the Admin area's Telemetry tab and turn off "Share anonymous usage data". The setting is stored deployment-wide and gates both server and browser events.
