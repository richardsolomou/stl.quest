# Core

Pure request, queue, visibility, and asset rules shared by server and browser.

## invariants

- prepared moves recover: A prepared model move resumes after a process restart without losing the request.
  over: a prepared move interrupted before completion and replayed twice by STLQuestService
  via: replays a prepared move idempotently after restart
  because: an interrupted asset change must not strand a request or duplicate its files.
  crossing: internal -> workspace-state
  refuted: skipped the prepared asset move during recovery -> the restart replay test failed before restore (2026-09-25)
  kinds: storage, state
  checklist: scoped-reads dismissed: replay uses the workspace-scoped service already bound to its operation.
  checklist: revalidated-permission dismissed: replay completes previously accepted internal work, not a new user action.
  checklist: encrypted-storage dismissed: the moved model is governed by its asset store, not encrypted by this rule.
  checklist: key-rotation-compatibility dismissed: replay does not rotate integration keys.
  checklist: input-validation dismissed: the operation payload was validated when it was recorded.
  checklist: revision-preservation dismissed: a move changes the active asset path, not versioned history.
  checklist: separation-of-duties dismissed: no second approver participates in recovery.
  checklist: legal-state-succession declared as prepared moves recover
  checklist: supersession-safety dismissed: recovery resumes the recorded move; competing replacements are handled by their own operation state.
  checklist: worker-fencing dismissed: replay has no lease generation.
  checklist: commit-ordered-effects declared as prepared moves recover
  checklist: durable-dispatch-intent declared as prepared moves recover
  checklist: resumption-coverage declared as prepared moves recover
  checklist: declared-target-coverage dismissed: the operation names one request and its asset paths.
  checklist: completion-evidence dismissed: the test observes the final request and stored model after replay.
