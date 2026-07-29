---
'stlquest': patch
---

Keep a workspace bootable when its storage recovery lease cannot be acquired, degrading to the storage-not-ready state and retrying later instead of failing the whole workspace runtime.
