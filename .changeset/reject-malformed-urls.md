---
'stl.quest': patch
---

Reject request paths with malformed percent-encoding with a 400, so that a single bad request can no longer crash the server.
