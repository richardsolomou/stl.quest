# PrintHub

For large existing libraries, use `ASSET_JOB_CONCURRENCY=1` under **Additional Environment Variables**. Each worker generally occupies one CPU core; higher values process multiple models simultaneously and can make an underpowered NAS unresponsive.

[PrintHub](https://github.com/richardsolomou/printhub) is a self-hosted 3D print request queue. Friends or customers upload STLs to a Kanban board (To Do, In Progress, Done), and the files stay ordinary files on storage you control.

On a fresh install, the first person to open the web UI claims the operator account — open it right after deploying.
