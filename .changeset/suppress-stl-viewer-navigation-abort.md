---
'stlquest': patch
---

Stop reporting the STL viewer's in-flight model download as an error when it is aborted by navigating away, reloading, or closing the request modal, so that a benign browser-initiated abort no longer pollutes error tracking.
