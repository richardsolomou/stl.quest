# Spoolman

STL Quest reads filament stock from [Spoolman](https://github.com/Donkie/Spoolman), which keeps track of every spool you own. Bambu Lab users' tools (Bambuddy, SpoolmanSync, Home Assistant) already write each AMS tray's measured usage into Spoolman, and anyone can weigh a spool into it, so its numbers are better than any per-print estimate.

Spoolman sends; STL Quest never reaches into your network and never holds an address or credentials for it. A small bridge next to Spoolman pushes spools out over HTTPS with a write-only token, so this works the same on [stl.quest](https://stl.quest) and on a self-hosted install.

## Connect

1. Open **Settings → Spoolman** as a workspace admin and select **Create token**. Copy it: it is shown once, and STL Quest keeps only a hash of it.
2. Run the bridge wherever it can reach Spoolman, usually in the same Compose file:

   ```yaml
   services:
     stlquest-spoolman-bridge:
       image: ghcr.io/richardsolomou/stl.quest-spoolman-bridge:latest
       restart: unless-stopped
       environment:
         SPOOLMAN_URL: http://spoolman:7912
         STLQUEST_URL: https://stl.quest
         STLQUEST_TOKEN: stlq_spoolman_…
   ```

   `SPOOLMAN_URL` is the address you open Spoolman at, including any base path. `STLQUEST_URL` is the address you open STL Quest at, including any `BASE_PATH`; the settings page shows it filled in.

3. Within a few seconds the page shows **Receiving** and lists the filaments Spoolman sent.

**Replace token** issues a new token and stops the old one at once; spools already received stay. **Disconnect** revokes the token and forgets the spools, so stock goes back to what STL Quest records. Filaments you linked by hand stay linked for when you reconnect.

### Bridge settings

| Variable              | Default | Meaning                                                                                           |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `SPOOLMAN_URL`        | —       | Spoolman's address.                                                                               |
| `STLQUEST_URL`        | —       | STL Quest's address. Must be `https` unless it is `localhost` or `STLQUEST_ALLOW_HTTP` is `true`. |
| `STLQUEST_TOKEN`      | —       | The token from **Settings → Spoolman**.                                                           |
| `STLQUEST_ALLOW_HTTP` | `false` | Allows plain HTTP to a self-hosted STL Quest on a network you trust.                              |
| `DEBOUNCE_SECONDS`    | `3`     | How long to wait after a change before sending, so a burst of changes sends once.                 |
| `RESYNC_SECONDS`      | `900`   | How often to read Spoolman again in case an event was missed.                                     |

The bridge listens to Spoolman's `/api/v1/` websocket, which reports spool, filament, and vendor changes. After each burst of changes and every `RESYNC_SECONDS` it reads every spool, archived ones included, and sends them all when anything changed; on start and after reconnecting it always sends. It needs only outbound access to STL Quest.

## How stock is counted

Each Spoolman filament counts towards one filament in **Consumables**. That filament's stock becomes the sum of `remaining_weight` across its spools that are not archived, and it is read-only in STL Quest: restock, count, and waste are done in Spoolman. Restocking from a pasted order email lists such a filament as one to add in Spoolman and leaves its stock alone. Its minimum stock still warns in **What you need**, and usage recorded at each step still counts towards cost and spend; it is never written back to Spoolman. Stock shows where usage and stock tracking is on (**Settings → General**).

A Spoolman filament finds its library filament in this order:

1. **Chosen by hand** under **Settings → Spoolman → Filaments**, including **Not counted**.
2. **Its SpoolmanDB entry.** Filaments Spoolman imported from [SpoolmanDB](https://github.com/Donkie/SpoolmanDB) keep its ID as `external_id`, such as `bambulab_pla_mattecharcoal_1000_175_n`. STL Quest's filament catalogue comes from SpoolmanDB and records each colour's ID without the weight, diameter, and spool type, so the ID finds the catalogue product and colour (Matte PLA · Charcoal), then the library filament with that product and colour. SpoolmanDB's IDs carry the product line only through the colour's name ("Matte Charcoal", "White Marble"), so an ID two catalogue colours share is not used.
3. **Brand, material, and colour**: the only catalogued library filament whose brand, material, and colour hex match the Spoolman filament.

A match that fits more than one library filament is left for you to choose.

## Send without the bridge

Anything that can send HTTP can send spools: Home Assistant's `rest_command`, a Bambuddy webhook, or a script.

```http
POST /api/spoolman/spools
Authorization: Bearer stlq_spoolman_…
Content-Type: application/json
```

The body is Spoolman's own JSON, in one of two shapes:

- **Every spool**, which replaces what STL Quest has: `{"spools": [<spool>, …]}`, as `GET /api/v1/spool?allow_archived=true` returns them. Leaving a spool out removes it.
- **One spool event**, as Spoolman's websocket sends it: `{"type": "added" | "updated" | "deleted", "resource": "spool", "payload": <spool>}`.

STL Quest reads these fields of a spool and ignores the rest: `id`, `remaining_weight`, `archived`, and its `filament`'s `id`, `name`, `material`, `color_hex`, `external_id`, and `vendor.name`.

| Response | Meaning                                                                       |
| -------- | ----------------------------------------------------------------------------- |
| `204`    | Received.                                                                     |
| `400`    | The body is not one of the shapes above.                                      |
| `401`    | The token is missing, revoked, or replaced.                                   |
| `413`    | The body is over 2 MB, or the workspace would hold more than 5,000 spools.    |
| `415`    | The body is not `application/json`.                                           |
| `429`    | More than 60 requests in a minute for this token; wait `Retry-After` seconds. |

For example, a Home Assistant `rest_command` that sends one spool:

```yaml
rest_command:
  stlquest_spool:
    url: https://stl.quest/api/spoolman/spools
    method: post
    headers:
      Authorization: !secret stlquest_spoolman_token # "Bearer stlq_spoolman_…"
    content_type: application/json
    payload: '{"type": "updated", "resource": "spool", "payload": {{ spool | tojson }}}'
```

## Security

- The token is the endpoint's only credential. It can add spools, and [Bambuddy's print events](bambuddy.md), to one workspace and nothing else: it reads nothing back and cannot sign in. Cookies are never read, so a browser cannot be tricked into sending one.
- STL Quest stores only a SHA-256 hash of the token. A database leak does not reveal it.
- The token is checked before the body is read, bodies are capped at 2 MB, and each token is limited to 60 requests a minute on each server.
- Spoolman has no authentication of its own, so keep it off the internet. The bridge only connects out, so nothing needs to be exposed.
