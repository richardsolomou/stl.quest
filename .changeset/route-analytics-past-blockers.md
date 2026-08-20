---
'stl.quest': patch
---

Send PostHog analytics through `/t` instead of `/ingest`, so ad-blocker lists that block that literal path segment no longer silence telemetry.
