---
'stlquest': patch
---

Return a handled 409 when an admin lowers a request's quantity below the copies already in progress, so the reason shows in the editor instead of surfacing as a server error and filing duplicate error-tracking issues.
