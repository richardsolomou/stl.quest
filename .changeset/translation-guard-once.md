---
'stl.quest': patch
---

Patch the browser-translation guard once per page instead of on every navigation, so that long sessions stop stacking wrappers around DOM methods.
