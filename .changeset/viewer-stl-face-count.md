---
'stl.quest': patch
---

Reject a corrupt binary STL in the 3D viewer before it reads the triangle count, so that a bad file shows "can't display this model" and does not try to reserve gigabytes of memory.
