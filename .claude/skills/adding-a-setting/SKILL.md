---
name: adding-a-setting
description: Add a product setting end to end — workspace vs deployment scope, the typed settings-table access, encryption for secrets, resetApp() for wiring changes, and the settings pane. Use when adding or changing any user-facing configuration.
---

# Adding a setting

Read [Adding a setting](../../../docs/development/settings.md) before changing code. That guide is the source of truth for scope, encryption, server behavior, UI structure, and documentation.

Workflow:

1. Choose workspace or deployment scope.
2. Implement storage, validation, authorization, and encryption as described in the guide.
3. Add the settings UI and tests.
4. Update operator or user documentation where needed.
5. Run `pnpm check`.
