---
'stlquest': patch
---

Retry transient gateway errors from WebDAV and other non-S3 storage backends during a migration, so a temporary 502 no longer aborts the whole run.
