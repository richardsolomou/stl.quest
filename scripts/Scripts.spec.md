# Scripts

Operator and release commands for backup, catalogs, and deployment.

## entrances

- backup: an operator requests a consistent SQLite backup at a chosen path.
  handler: options in backup.ts
  trust: operator-input
- preview deploy: CI creates a disposable pull request deployment.
  handler: deploy in previewDeploy.ts
  trust: operator-input
- preview delete: CI removes one disposable deployment.
  handler: remove in previewDeploy.ts
  trust: operator-input
- preview prune: CI removes deployments for closed pull requests.
  handler: prune in previewDeploy.ts
  trust: operator-input
- seed preview: CI seeds a disposable deployment with sample requests.
  handler: seedPreview in seedPreview.ts
  trust: operator-input
- sync printer presets: an operator updates or validates the printer data.
  handler: synchronizeCatalog in syncPrinterCatalog.ts
  trust: operator-input
- sync resin presets: an operator updates or validates the resin data.
  handler: synchronizeCatalog in syncResinCatalog.ts
  trust: operator-input
- sync electricity presets: an operator updates or validates the electricity data.
  handler: synchronizeCatalog in syncElectricityCatalog.ts
  trust: operator-input

## invariants
