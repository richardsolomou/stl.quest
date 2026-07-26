---
name: extending-e2e
description: Run and extend the Playwright end-to-end suite — the main journey, isolated specs, fixtures, screenshots, and why retries are off. Use when a feature or fix needs e2e coverage or when running or debugging e2e locally.
---

# Extending the e2e suite

Read [End-to-end testing](../../../docs/development/e2e-testing.md) before changing tests. That guide is the source of truth for commands, suite structure, shared state, screenshots, and debugging.

Workflow:

1. Put the scenario in the main journey or an isolated spec as described in the guide.
2. Wait for visible behavior, not fixed timing.
3. Run the focused test while iterating.
4. Finish with `pnpm test:e2e`, or use `pnpm test:e2e:screenshots` instead for UI changes and inspect the results.
