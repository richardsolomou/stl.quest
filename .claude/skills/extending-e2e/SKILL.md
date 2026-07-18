---
name: extending-e2e
description: Run and extend the Playwright end-to-end suite — the single journey spec, fixtures, screenshots, and why retries are off. Use when a feature or fix needs e2e coverage or when running or debugging e2e locally.
---

# Extending the e2e suite

Running:

- `pnpm test:e2e:install` once (Chromium only), then `CI=1 pnpm test:e2e` to match CI. Playwright builds and starts a real server against temp `DATA_DIR`/`PRINTS_DIR` dirs.
- Focused run: `pnpm test:e2e --grep "<title fragment>"`.
- `workers: 1`, `fullyParallel: false`, and retries are disabled on purpose: the journey mutates its own database, so a retry runs against dirty state and proves nothing. Don't re-enable retries — fix the flake instead (toast/navigation races have been the usual culprits; wait on visible state, not timing).

Structure:

- `e2e/printhub.spec.ts` is one long sequential journey (onboarding → storage → printers → workspaces → uploads → settings → invites). Most features extend it at the matching stage rather than adding a new file.
- A separate spec (like `e2e/request-ordering.spec.ts`) is warranted only when the scenario needs its own isolated state.
- Fixtures: `e2e/fixtures/stl.ts` synthesizes STL box geometry programmatically (`boxStl(name, width, depth, height)`); static binaries cover oversized/edge cases.
- The `screenshot()`/`mobileScreenshot()` helpers run only locally (skipped in CI) and write to `test-results/manual-inspection/` — inspect them after UI changes, including the 320px mobile viewport.
