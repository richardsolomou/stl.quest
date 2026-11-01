---
'stl.quest': patch
---

Close idle connections to a hosted workspace's S3 or WebDAV storage after five seconds, so that a storage server that never hangs up cannot keep connections open on the hosted service.
