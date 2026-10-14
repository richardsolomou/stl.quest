---
'stl.quest': patch
---

Stream large batch downloads one model at a time and release storage connections when a download is cancelled, so that downloading a whole queue no longer hangs and thumbnails keep loading.
