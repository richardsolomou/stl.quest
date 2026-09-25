# Db

Workspace-scoped persistence and database lifecycle.

## invariants

- workspace records stay isolated: A workspace-scoped repository cannot read or change another workspace's tenant records.
  over: requests, printers, settings, invites, uploads, members, and tenant foreign keys exercised by two scoped repositories
  via: isolates workspace requests, printers, invites, uploads, and members
  because: a tenant boundary must hold for reads, mutations, and related records even when their local ids are known.
  crossing: verified-identity -> workspace-state
  refuted: removed the workspace predicate from request lookup -> the two-workspace isolation test failed before restore (2026-09-25)
  kinds: read, storage
  checklist: scoped-reads declared as workspace records stay isolated
  checklist: encrypted-storage dismissed: this rule is about tenant ownership; encryption of integration secrets is separate.
  checklist: key-rotation-compatibility dismissed: no encrypted key changes in a scoped repository query.
  checklist: redaction dismissed: other-workspace rows are omitted, not returned with fields hidden.
  checklist: input-validation dismissed: tenant ownership is applied by repository queries and foreign keys, not an input schema.
  checklist: revision-preservation dismissed: tenant rows are not version-addressed publications.
  checklist: commit-ordered-effects dismissed: the rule checks stored rows and relationships, not external effects.
  checklist: durable-dispatch-intent dismissed: no external dispatch is part of the scoped query.
  checklist: declared-target-coverage dismissed: the test names tenant record classes, not a live fan-out registry.
  checklist: completion-evidence dismissed: reads and writes settle in the database transaction.
- copy quantities stay valid: A request never assigns more copies to production statuses than its quantity allows.
  over: create, move, and status deletion paths exercised by the repository quantity test
  via: enforces quantity invariants and cascades status deletion
  because: production counts must describe actual copies without inventing or losing work.
  crossing: internal -> workspace-state
  refuted: disabled the started-copy quantity bound -> the quantity invariant test failed before restore (2026-09-25)
  kinds: state, storage
  checklist: scoped-reads dismissed: this rule concerns writes to one already scoped request.
  checklist: revalidated-permission dismissed: authorization is completed before these repository operations.
  checklist: encrypted-storage dismissed: copy quantities are not confidential fields.
  checklist: key-rotation-compatibility dismissed: no encryption key participates in quantity updates.
  checklist: input-validation declared as copy quantities stay valid
  checklist: revision-preservation dismissed: statuses are mutable state, not retained revisions.
  checklist: separation-of-duties dismissed: no approval role is involved in quantity changes.
  checklist: legal-state-succession declared as copy quantities stay valid
  checklist: supersession-safety dismissed: the database serializes the quantity change; no delayed publication wins over it.
  checklist: worker-fencing dismissed: no leased worker owns a quantity update.
  checklist: commit-ordered-effects dismissed: the quantity update has no irreversible external side effect.
  checklist: durable-dispatch-intent dismissed: queue counts do not dispatch external work.
  checklist: resumption-coverage dismissed: this rule does not replay a range or checkpoint.
  checklist: declared-target-coverage dismissed: one request is updated, with no fan-out registry.
  checklist: completion-evidence dismissed: the committed rows are the outcome being checked.
