---
'stlquest': patch
---

Delete a request whose cloud storage file has already been removed instead of failing the board action, so that a file that vanishes mid-delete no longer surfaces an error.
