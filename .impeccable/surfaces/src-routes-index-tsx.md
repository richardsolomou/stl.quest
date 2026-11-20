---
version: 1
slug: 'src-routes-index-tsx'
primary_target: 'src/routes/index.tsx'
related_targets: ['src/client/components/Board.tsx', 'src/client/components/AppShell.tsx']
---

# Board and core loop (Operate)

Scope: app shell, board, request detail, add-a-print intake. Settings, archive, calculator, and auth inherit the new tokens without restructuring. Visitor mode: Operate. Primary user: the operator deciding what to print next and where each copy is; secondary: requesters checking status.

Replacement world chosen by the user on 2026-11-19 (clean slate; logo and fixed terminology are product truth). Board model rethought around the operator's next decision while keeping the five stages and per-copy truth.

## Direction contract

THESIS: The board is an expo pass. Requests are thermal tickets; the operator calls what fires next. Refuses five equal kanban lanes of identical cards with a ×N chip.

OWN-WORLD: Brushed-steel light ground, paper tickets, black thermal ink, a second thermal red for notes (modifiers), age that has gone hot, and the one commit action. Ink-black top bar. Stage colours: queue graphite, up next blue, printing heat amber, finishing violet, ready green, used as flat fills that own regions (zone heading count chips, printer station headers, ticket bars, copy cells). Archivo across its width axis (condensed heavy for ticket names, normal for UI), Martian Mono for figures and ticket headers. Dark theme: the same pass at night, dark steel with dimmed paper.

STORY: The operator sees at a glance what fires next, which printer is idle, what is waiting too long, and who has prints ready to collect; they start, finish, and reorder copies in one or two actions.

FIRST VIEWPORT: Ink header: the bar (brand, workspace, navigation, account) with the board toolbar (search, filters, Add a print in red) set into the ink beneath it. Three zones, each headed by its stage name and a stage-coloured copy count that selects the whole stage: Queue as a dense backlog list (left, ~360px); centre with the Up next rail of hanging tickets, first ticket largest, then Printing grouped into printer stations with idle printers flagged and the next compatible ticket offered; right, the pass: Finishing slips and the Ready pickup shelf grouped by requester.

FORM: Kitchen expo ticket rail, position 4 of 7 on the ordered list. seed:83bcb8bc82f00bc8. Raises: copies as counted stage-coloured cells (star atlas); flat colour owns regions (zoo map); one requester, one ink plate everywhere (character catalog). The type-specimen density-control raise was dropped at the first finish review: it was agent-invented scope, not a user ask. The acetate-manual raise (a stage tab strip sized by copy count) was removed at the user's request on 2026-11-19: it repeated the zone headings, so its select-all moved onto them.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: tickets ride the rail; dragging or firing a ticket moves it between zones with a short slide-and-settle, and copy cells restamp in their new stage colour.

## Unresolved

- Printer grouping inside Printing depends on request-level printer assignment; copies without a printer group under "Unassigned".
- Keyboard equivalent for drag-and-drop remains open (PRODUCT.md).
