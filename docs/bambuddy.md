# Bambuddy

STL Quest reads what your printers actually ran from [Bambuddy](https://github.com/maziggy/bambuddy), which watches Bambu Lab printers on your network. Each print it reports links to the plate run it was, so that run records real hours and grams, and its outcome counts towards the printer's failures.

Bambuddy only sends; STL Quest never sends or dispatches a print to it, since STL Quest owns the queue. Stock still comes from [Spoolman](spoolman.md), which Bambuddy already keeps up to date.

## Plate runs

A plate run is the prints that go on one plate of one printer. Select their cards on the board and choose **Start a plate**: they move to Printing together on the printer you pick, and every card on it wears the plate's number. From then on its copies only move as one:

- **Move plate to Finishing** on the printer's station, or moving any of its cards, moves every print on the plate.
- A move, group move, or delete that would take some of a plate's copies on their own is refused.
- The run ends once its prints leave Printing and Finishing, usually when they are ready, or when usage tracking is switched off.

Choosing only prints already past Printing records a run that already happened, as before.

A plate run counts as one plate towards wear parts that last a number of plates, however many prints it holds. Plates need usage and stock tracking, under **Settings → General**.

## Connect

Bambuddy sends with the workspace's ingest token, the same one the Spoolman bridge uses.

1. Create the token under **Settings → Spoolman** as a workspace admin, if you have not already.
2. In Bambuddy, open **Settings → Notifications** and add a **Webhook** provider:
   - **URL**: the webhook URL shown under **Settings → Bambuddy**, `https://<your STL Quest>/api/bambuddy/events`, including any `BASE_PATH`.
   - **Authorization header**: the token. Bambuddy adds `Bearer` itself.
   - **Payload format**: Generic.
   - **Events**: print start, print complete, print failed, and print stopped.
   - Turn off attaching photos; STL Quest does not use them, and they make every request larger.
3. Name each printer the same in Bambuddy and STL Quest, ignoring case, so a print finds its printer.

Bambuddy's **Test** button sends a test notification, which STL Quest accepts and ignores. **Settings → Bambuddy** shows **Receiving** once a print arrives.

## How a print finds its plate

When a print starts or ends, STL Quest links it to:

1. **The plate printing on that printer**: the plate run most recently started in Printing on the STL Quest printer with Bambuddy's printer name, unless another print is already linked to it, since one plate run is one print.
2. **The plate of the request its name is tagged with.** Models downloaded from STL Quest are named after their request, such as `SQ-142 Plasma.3mf`, and the tag usually survives into the Bambu Studio job name Bambuddy reports. The tag links to the plate printing that request, else its newest plate not recorded yet, skipping plates whose print already ended, so a reprint after a failure never lands on the failed run.
3. **Nothing.** The print waits under **Settings → Bambuddy → Unlinked prints**, where you attach it to a plate, to the request its tag names (which puts all its copies on a new plate), or mark it personal.

A print's start and end are one print: Bambuddy's end event continues the start on the same printer under the same name.

## What a print records

- **Finished**: the plate records Bambuddy's measured hours and grams, split across its prints by model volume, then estimate, then copies, just as typed plate totals are. The grams use the first filament in **Consumables**. A plate already recorded from a slicer file or typed totals keeps that recording, and a plate shared with things not in STL Quest is left for you to record, since Bambuddy cannot tell what share was yours.
- **Failed** or **cancelled**: its hours and grams are recorded as failed usage on the plate's prints, which still wears the printer, and the plate's copies go back to Up next, flagged with the plate that failed, to be printed again.
- Each printer's dialog under **Settings → Printers** shows its plate runs Bambuddy reported and how many failed or were cancelled.

A repeated end event records nothing twice. The workspace keeps the newest 2,000 prints.

Per-tray grams, Spoolman spool IDs, per-object splits from sliced files, and per-object failures need more than Bambuddy's webhook carries and are not read yet.

## The endpoint

```http
POST /api/bambuddy/events
Authorization: Bearer stlq_spoolman_…
Content-Type: application/json
```

The body is Bambuddy's generic webhook JSON. STL Quest reads `event`, `printer`, `filename`, `duration` (such as `1h 23m`), `filament_grams` (such as `12.3`), `filament_details`, `reason`, `progress`, `archive_id`, and `run_id`, and ignores the rest. It keeps `print_start`, `print_complete`, `print_failed`, and `print_stopped`, and accepts and drops every other event.

| Response | Meaning                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `204`    | Received.                                                                     |
| `400`    | The body is not a Bambuddy notification.                                      |
| `401`    | The token is missing, revoked, or replaced.                                   |
| `413`    | The body is over 4 MB.                                                        |
| `415`    | The body is not `application/json`.                                           |
| `429`    | More than 60 requests in a minute for this token; wait `Retry-After` seconds. |

## Security

- The token can only add prints and spools to one workspace. It reads nothing back and cannot sign in, and cookies are never read, so a browser cannot be made to send one.
- STL Quest stores only a SHA-256 hash of the token.
- The token is checked before the body is read, bodies are capped at 4 MB, and each token is limited to 60 requests a minute on each server.
- What a print reports is shown only to workspace admins, and only its outcome and whether it linked reach telemetry, never its file or printer name.
