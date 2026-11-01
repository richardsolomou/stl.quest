---
'stl.quest': patch
---

Close the connection to a hosted workspace's mail server when it runs past the 20-second limit, so that a slow server cannot keep connections open after the send has failed.
