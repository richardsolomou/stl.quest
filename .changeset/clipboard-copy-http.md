---
'stlquest': patch
---

Fix copy buttons throwing and doing nothing on self-hosted installs served over plain HTTP by feature-detecting the Clipboard API and falling back to a legacy copy path.
