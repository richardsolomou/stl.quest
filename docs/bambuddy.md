# Bambuddy

STL Quest reads what your printers actually ran from [Bambuddy](https://github.com/maziggy/bambuddy), which watches Bambu Lab printers on your network. Each print it reports links to the plate run it was, so that run records real hours and grams, and its outcome counts towards the printer's failures.

Bambuddy only sends; STL Quest never sends or dispatches a print to it, since STL Quest owns the queue. Stock still comes from [Spoolman](spoolman.md), which Bambuddy already keeps up to date.

## Plate runs

A plate run is the prints that go on one plate of one printer. Select their cards on the board and choose **Start a plate**: they move to Printing together on the printer you pick, and every card on it wears the plate's number. From then on its copies only move as one:

- **Move plate to Finishing** on the printer's station, or moving any of its cards, moves every print on the plate.
- A move, group move, or delete that would take some of a plate's copies on their own is refused.
- Its prints stay on its printer: assigning one of them to another printer, on its own or in bulk, is refused.
- The run ends once its prints leave Printing and Finishing, usually when they are ready, or when usage tracking is switched off.

Choosing only prints already past Printing records a run that already happened, as before.

A plate run counts as one plate towards wear parts that last a number of plates, however many prints it holds. Plates need usage and stock tracking, under **Settings → General**.

Recording a plate from a sliced `.gcode.3mf` matches each object to its print by the `SQ-<n>` tag in its name first. Models downloaded from STL Quest carry it, and Bambu Studio and OrcaSlicer keep it on every copy, cut part, and split part, such as `SQ-142 Plasma.stl_2`. Objects without a tag, or tagged with a request that is not on the plate, match by the model's file name, then the print's name, ignoring the tag in front.

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

- **Finished**: the plate records Bambuddy's measured hours and grams, split across its prints by model volume, then estimate, then copies, just as typed plate totals are, until the bridge sends the print's sliced file (see [Sliced files](#sliced-files)). The grams go by each tray's material (see [Filaments](#filaments)) until the bridge reports which spools the print used (see [Grams per spool](#grams-per-spool)). A plate already recorded from a slicer file or typed totals keeps that recording, and a plate shared with things not in STL Quest is left for you to record, since Bambuddy cannot tell what share was yours.
- **Failed** or **cancelled**: its hours and grams are recorded as failed usage on the plate's prints, which still wears the printer, and the plate's copies go back to Up next, flagged with the plate that failed, to be printed again. Bambuddy already scales a stopped print's grams to how far it got, so each print's share is what it had used by then. A plate recorded from a slicer file before it failed splits that waste by what the file measured for each print rather than by volume, until the bridge sends the print's sliced file, which charges each object up to where the print stopped.
- Each printer's dialog under **Settings → Printers** shows its plate runs Bambuddy reported finished or failed, and how many failed. A stopped print is someone's choice, not the printer failing, so it is left out.

A repeated end event records nothing twice. The workspace keeps the newest 2,000 prints.

### Filaments

Bambuddy lists the grams each AMS tray or external spool used, such as `AMS-A T1 PLA: 30.0g | AMS-A T2 PETG: 10.0g`. Each tray's grams go to the first filament in **Consumables** whose catalogue product is that material, else its "+" kind (PLA+ spools from eSUN and SUNLU report plain PLA), else to the first filament, and each filament's grams are split across the plate's prints by volume. The trays are what Bambuddy measured, so they are the whole print: `filament_grams` is the slicer's estimate and adds nothing on top. Without trays, Bambuddy lists the slicer file's slots instead (`PLA: 30.0g`), and grams those slots leave out go to the first filament. The breakdown names only a material, so two colours of the same material count against the first filament of that material.

## Grams per spool

Bambuddy's webhook names only each tray's material, so two colours of one material count against the same filament. When Bambuddy charges your [Spoolman](spoolman.md) spools, the Spoolman bridge can read which spool each print used and send that instead, which takes the place of the trays:

1. In Bambuddy, open **Settings → API Keys** and create a key with only **Read Status** allowed.
2. Give the bridge Bambuddy's address and the key:

   ```yaml
   environment:
     BAMBUDDY_URL: http://bambuddy:8000
     BAMBUDDY_API_KEY: bb_…
   ```

Every `BAMBUDDY_POLL_SECONDS` (60 by default) the bridge reads Bambuddy's print log (`GET /api/v1/print-log/`) and its Spoolman usage history (`GET /api/v1/inventory/usage?spoolman=true`). That history names a spool, a printer, a print, and grams, but no run, so the bridge gives each charge to the run on the same printer, of the same print, that ended within ten minutes of it. It sends each run's spools to `POST /api/bambuddy/usage`, with the same token and the run ID Bambuddy's end event carried:

```json
{ "run_id": "512", "spools": [{ "spool_id": 12, "grams": 30.4 }] }
```

STL Quest charges each spool's grams to the filament its Spoolman filament counts towards (**Settings → Spoolman → Filaments**), and any spool Spoolman never sent to the first filament. A finished print whose plate it recorded is recorded again from the spools; a plate recorded from a slicer file or typed totals keeps that. A failed or cancelled print's failed usage is recorded again from them, without moving its copies a second time. A print STL Quest has not received yet answers `404`, so the bridge sends it again on its next poll, for up to an hour after the run ended. The bridge sends at most ten runs a poll and skips runs that ended over an hour ago, including when it starts, so runs that ended while it was stopped for longer are not recorded by spool. That endpoint has its own limit of 60 requests a minute per token, so the bridge can never use up the allowance Bambuddy's notifications need.

The key and Bambuddy's address stay in the bridge; STL Quest never holds them, and the bridge only reads from Bambuddy. Bambuddy's built-in inventory keeps its own spools, which STL Quest cannot match, so their prints keep going by their trays' materials.

## Sliced files

With the bridge reading Bambuddy (see [Grams per spool](#grams-per-spool)), STL Quest also asks it for the sliced `.gcode.3mf` of each print it linked to a plate run and recorded itself, for up to a day after the print ended. Each poll, after sending spools, the bridge asks `GET /api/bambuddy/sliced` which prints want a file, downloads at most three of them from Bambuddy's archive (`GET /api/v1/archives/{archive_id}/download`), and streams each to `POST /api/bambuddy/sliced?run_id=…&plate=…`. The plate is the one Bambuddy's print log says the run printed, for a file of several plates. Nothing is stored in the bridge but which files it skipped, and STL Quest keeps only what it read from the file, never the file.

The same **Read Status** key reads the archive, since Bambuddy grants archive reads to it. The key acts as the user who made it, so that user needs to see every archive (`archives:read_all`), or the bridge only gets the files of prints they started. A file Bambuddy's archive does not have, one over 64 MB, and one STL Quest cannot read are skipped, and the print keeps the split it had. The bridge tells STL Quest about each file it skips (`DELETE /api/bambuddy/sliced?run_id=…`), so STL Quest stops asking for it and its place goes to newer prints. STL Quest reads each file off the request thread, in the same worker, time limit, and memory budget as model previews (`ASSET_WORKER_MEMORY_MB`), and treats as unreadable a file whose G-code and slice info inflate past 512 MB, past the sizes its zip directory claims, or with slice info over 8 MB.

STL Quest reads the plate the same way as an uploaded file: each labelled object's grams per filament, matched to its print by its `SQ-<n>` tag, then by name (see [Plate runs](#plate-runs)), with purge and prime tower shared out by weight and objects not in STL Quest kept apart. What the printer measured wins: each filament's figures are scaled so they add up to the grams Bambuddy reported for its material, or charged to its spool, and the plate's time is Bambuddy's measured duration. When the file's filaments and the measured ones don't line up, every figure is scaled by the measured total instead. Then:

- **Finished**: the plate's recording is replaced by the per-object split, which shows as **Measured by the slicer for each object**.
- **Failed** or **cancelled**: the waste is split by what each object had printed when it stopped, scaled to the grams Bambuddy measured; with none measured, the file adds no waste. Without a `progress`, the measured grams are split by each object's whole share. Bambu Studio and OrcaSlicer print layer by layer and mark progress in the G-code (`M73 P`), the same percentage the printer reports, so STL Quest reads each object's extrusion up to the first marker past Bambuddy's `progress`: an object shorter than where the print stopped counts in full and a taller one only up to that height, each as waste on its own request. Bambuddy sends no failed layer, only `progress`. A file without progress markers falls back to splitting the waste by each object's whole share, and the plate's dialog says so.

A plate recorded by hand, from an uploaded file or typed totals, keeps that recording, and its print's file is never fetched. Spools the bridge sends later are scaled onto the same per-object split.

## Pricing from the failure rate

Once a printer has 20 finished or failed plate runs reported, quotes for it price failures from its own share of failed runs instead of the flat failure allowance under **Settings → Pricing**. Stopped prints don't count either way. A workspace whose allowance is 0% keeps pricing no failures. The quote's breakdown says which one it used. At 20 runs one failure moves the rate by 5 points, half the default allowance; with fewer, one bad run would move a quote by more than the allowance it replaces.

Failures of single skipped objects aren't read: Bambuddy can skip an object on a running print, but reports it in neither its webhook nor its archive.

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

The bridge's sliced files use their own endpoint, with the same token:

```http
GET /api/bambuddy/sliced
POST /api/bambuddy/sliced?run_id=512&plate=1
DELETE /api/bambuddy/sliced?run_id=512
Authorization: Bearer stlq_spoolman_…
Content-Type: application/octet-stream
```

`GET` answers `{"runs": [{"run_id": "512", "archive_id": "88"}]}`, at most ten prints. `POST` takes the file's bytes and answers `204` once read (or for a print that no longer wants a file), `404` for a run STL Quest hasn't received, `413` over 64 MB, `415` for anything but `application/octet-stream`, and `422` for a file that is not a sliced plate with labelled objects, or holds several plates without `plate`. `DELETE` says the bridge cannot send a run's file and answers `204`, or `404` for a run STL Quest hasn't received. All three share a limit of 20 requests a minute per token.

## Security

- The token can only add prints, what they used per spool, their sliced files, and spools to one workspace. The only things it reads back are the spools the workspace's admins queued for the bridge to add to Spoolman ([Spoolman](spoolman.md#security)), and the Bambuddy run and archive IDs of prints that want a sliced file, which Bambuddy itself sent. It reads no stock, requests, or prints, cannot sign in, and cookies are never read, so a browser cannot be made to send one.
- STL Quest stores only a SHA-256 hash of the token.
- The token is checked before the body is read, bodies are capped at 4 MB (64 MB for a sliced file, refused as soon as it streams past that), and each token is limited to 60 requests a minute on each server for Bambuddy's notifications, another 60 for the bridge's spool usage, and 20 for sliced files.
- What a print reports is shown only to workspace admins, and only its outcome and whether it linked reach telemetry, never its file or printer name.
