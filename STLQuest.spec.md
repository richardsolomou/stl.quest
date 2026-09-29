# STLQuest

Self-hosted print request intake, workspace isolation, and production queue management.

## trust levels

- network (outside): URL paths, headers, cookies, payloads, and file bytes supplied by a browser or HTTP client.
- provider-response (outside): OAuth callbacks and remote storage or source responses supplied by external services.
- operator-input (outside): command arguments and deployment configuration supplied by an operator or CI.
- internal: work generated and passed between application processes after entry checks.
- verified-identity: an authenticated principal resolved from the current request.
- workspace-state: data scoped to an authorized workspace and persisted by the application.

## invariants
