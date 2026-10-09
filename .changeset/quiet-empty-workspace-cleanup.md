---
'stl.quest': patch
---

Skip the startup asset layout cleanup for empty workspaces that have no storage folder yet, so that the server stops logging a warning for each of them on every restart.
