# Scripts

Operator and release commands for backup, catalogs, and deployment.

## entrances

- check built assets: CI verifies that the server build references an emitted stylesheet.
  handler: checkBuiltAssets.ts
  trust: operator-input
- check equipment catalog: CI or an operator validates the equipment presets.
  handler: checkEquipmentCatalog.ts
  trust: operator-input
- check markdown links: CI checks local links in project documentation.
  handler: checkMarkdownLinks.ts
  trust: operator-input
- check unraid metadata: CI validates the Unraid package metadata.
  handler: checkUnraidMetadata.ts
  trust: operator-input
- container runtime: the container starts the application and realtime processes from deployment configuration.
  handler: containerRuntime.ts
  trust: operator-input
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
- sync release version: the release job copies the package version into deployment metadata.
  handler: syncReleaseVersion.ts
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
- update printer images: an operator refreshes printer catalog images from external sources.
  handler: updatePrinterImages.ts
  trust: operator-input

## invariants
