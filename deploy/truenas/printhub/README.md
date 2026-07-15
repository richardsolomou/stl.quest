# PrintHub

For large existing libraries, use `ASSET_JOB_CONCURRENCY=1` under **Additional Environment Variables**. Each worker generally occupies one CPU core; higher values process multiple models simultaneously and can make an underpowered NAS unresponsive.

[PrintHub](https://github.com/richardsolomou/printhub) is a private, self-hosted 3D-print production queue for resin and filament printers. Accept STL requests, assign them to printers or same-print-type pools, plan build plates across a changing fleet, and track each copy through Queue, Printing, Finishing, and Ready while files stay on storage you control. No vendor cloud or printer account is required.

On a fresh install, the first person to open the web UI claims the admin account — open it right after deploying.
