---
'stl.quest': patch
---

Reload once when part of the app fails to download during page load, and offer a refresh if it keeps failing or a later download fails, so that a deploy or a flaky connection no longer leaves a page that never responds.
