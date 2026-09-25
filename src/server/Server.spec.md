# Server

Authentication, server functions, uploads, and request orchestration.

## entrances

- reportRouteError: POST server function to report route error.
  handler: reportRouteError in fns.ts
  trust: network
- createWorkspace: POST server function to create workspace.
  handler: createWorkspace in fns.ts
  trust: network
- deleteWorkspace: POST server function to delete workspace.
  handler: deleteWorkspace in fns.ts
  trust: network
- switchWorkspace: POST server function to switch workspace.
  handler: switchWorkspace in fns.ts
  trust: network
- sessionInfo: GET server function to session info.
  handler: sessionInfo in fns.ts
  trust: network
- getPrinters: GET server function to get printers.
  handler: getPrinters in fns.ts
  trust: network
- savePrinterProfiles: POST server function to save printer profiles.
  handler: savePrinterProfiles in fns.ts
  trust: network
- getPlanOverview: GET server function to get plan overview.
  handler: getPlanOverview in fns.ts
  trust: network
- getAccountMethods: GET server function to get account methods.
  handler: getAccountMethods in fns.ts
  trust: network
- getAuthCapabilities: GET server function to get auth capabilities.
  handler: getAuthCapabilities in fns.ts
  trust: network
- setOwnPassword: POST server function to set own password.
  handler: setOwnPassword in fns.ts
  trust: network
- changeOwnEmail: POST server function to change own email.
  handler: changeOwnEmail in fns.ts
  trust: network
- unlinkOwnAccount: POST server function to unlink own account.
  handler: unlinkOwnAccount in fns.ts
  trust: network
- getIntegrationSettings: GET server function to get integration settings.
  handler: getIntegrationSettings in fns.ts
  trust: network
- updatePasswordAuth: POST server function to update password auth.
  handler: updatePasswordAuth in fns.ts
  trust: network
- saveSocialProvider: POST server function to save social provider.
  handler: saveSocialProvider in fns.ts
  trust: network
- updateSocialProviderEnabled: POST server function to update social provider enabled.
  handler: updateSocialProviderEnabled in fns.ts
  trust: network
- saveSmtpSettings: POST server function to save smtp settings.
  handler: saveSmtpSettings in fns.ts
  trust: network
- removeSmtpSettings: POST server function to remove smtp settings.
  handler: removeSmtpSettings in fns.ts
  trust: network
- listRequests: GET server function to list requests.
  handler: listRequests in fns.ts
  trust: network
- listPeople: GET server function to list people.
  handler: listPeople in fns.ts
  trust: network
- listUsers: GET server function to list users.
  handler: listUsers in fns.ts
  trust: network
- listAccounts: GET server function to list accounts.
  handler: listAccounts in fns.ts
  trust: network
- listAdminWorkspaces: GET server function to list admin workspaces.
  handler: listAdminWorkspaces in fns.ts
  trust: network
- getAdminWorkspace: GET server function to get admin workspace.
  handler: getAdminWorkspace in fns.ts
  trust: network
- getAdminAccount: GET server function to get admin account.
  handler: getAdminAccount in fns.ts
  trust: network
- updateWorkspaceMemberRole: POST server function to update workspace member role.
  handler: updateWorkspaceMemberRole in fns.ts
  trust: network
- removeWorkspaceMember: POST server function to remove workspace member.
  handler: removeWorkspaceMember in fns.ts
  trust: network
- createInvite: POST server function to create invite.
  handler: createInvite in fns.ts
  trust: network
- listInvites: GET server function to list invites.
  handler: listInvites in fns.ts
  trust: network
- revokeInvite: POST server function to revoke invite.
  handler: revokeInvite in fns.ts
  trust: network
- inviteInfo: GET server function to invite info.
  handler: inviteInfo in fns.ts
  trust: network
- beginProviderInvite: POST server function to begin provider invite.
  handler: beginProviderInvite in fns.ts
  trust: network
- acceptInvite: POST server function to accept invite.
  handler: acceptInvite in fns.ts
  trust: network
- acceptWorkspaceInvite: POST server function to accept workspace invite.
  handler: acceptWorkspaceInvite in fns.ts
  trust: network
- getTelemetrySettings: GET server function to get telemetry settings.
  handler: getTelemetrySettings in fns.ts
  trust: network
- getOnboardingProgress: GET server function to get onboarding progress.
  handler: getOnboardingProgress in fns.ts
  trust: network
- updateOnboardingProgress: POST server function to update onboarding progress.
  handler: updateOnboardingProgress in fns.ts
  trust: network
- updateTelemetrySettings: POST server function to update telemetry settings.
  handler: updateTelemetrySettings in fns.ts
  trust: network
- getBoardSettings: GET server function to get board settings.
  handler: getBoardSettings in fns.ts
  trust: network
- getPriceCalculatorSettings: GET server function to get price calculator settings.
  handler: getPriceCalculatorSettings in fns.ts
  trust: network
- savePriceCalculatorSettings: POST server function to save price calculator settings.
  handler: savePriceCalculatorSettings in fns.ts
  trust: network
- getDiagnostics: GET server function to get diagnostics.
  handler: getDiagnostics in fns.ts
  trust: network
- getSystemDiagnostics: GET server function to get system diagnostics.
  handler: getSystemDiagnostics in fns.ts
  trust: network
- getReleaseUpdate: GET server function to get release update.
  handler: getReleaseUpdate in fns.ts
  trust: network
- updateBoardSettings: POST server function to update board settings.
  handler: updateBoardSettings in fns.ts
  trust: network
- updateMemberRequestVisibility: POST server function to update member request visibility.
  handler: updateMemberRequestVisibility in fns.ts
  trust: network
- getStorageSettings: GET server function to get storage settings.
  handler: getStorageSettings in fns.ts
  trust: network
- listStorageDirectories: POST server function to list storage directories.
  handler: listStorageDirectories in fns.ts
  trust: network
- getStorageMigration: GET server function to get storage migration.
  handler: getStorageMigration in fns.ts
  trust: network
- testStorageConnection: POST server function to test storage connection.
  handler: testStorageConnection in fns.ts
  trust: network
- getCloudConnections: GET server function to get cloud connections.
  handler: getCloudConnections in fns.ts
  trust: network
- saveCloudStorageApp: POST server function to save cloud storage app.
  handler: saveCloudStorageApp in fns.ts
  trust: network
- setCloudStorageProviderEnabled: POST server function to set cloud storage provider enabled.
  handler: setCloudStorageProviderEnabled in fns.ts
  trust: network
- removeCloudStorageApp: POST server function to remove cloud storage app.
  handler: removeCloudStorageApp in fns.ts
  trust: network
- beginCloudConnection: POST server function to begin cloud connection.
  handler: beginCloudConnection in fns.ts
  trust: network
- removeCloudConnection: POST server function to remove cloud connection.
  handler: removeCloudConnection in fns.ts
  trust: network
- startStorageMigration: POST server function to start storage migration.
  handler: startStorageMigration in fns.ts
  trust: network
- retryStorageMigration: POST server function to retry storage migration.
  handler: retryStorageMigration in fns.ts
  trust: network
- cancelStorageMigration: POST server function to cancel storage migration.
  handler: cancelStorageMigration in fns.ts
  trust: network
- acknowledgeStorageMigration: POST server function to acknowledge storage migration.
  handler: acknowledgeStorageMigration in fns.ts
  trust: network
- updateStorageSettings: POST server function to update storage settings.
  handler: updateStorageSettings in fns.ts
  trust: network
- moveCopies: POST server function to move copies.
  handler: moveCopies in fns.ts
  trust: network
- createLinkedRequest: POST server function to create linked request.
  handler: createLinkedRequest in fns.ts
  trust: network
- moveCopiesBatch: POST server function to move copies batch.
  handler: moveCopiesBatch in fns.ts
  trust: network
- createPrintGroup: POST server function to create print group.
  handler: createPrintGroup in fns.ts
  trust: network
- movePrintGroup: POST server function to move print group.
  handler: movePrintGroup in fns.ts
  trust: network
- movePrintGroupItem: POST server function to move print group item.
  handler: movePrintGroupItem in fns.ts
  trust: network
- renamePrintGroup: POST server function to rename print group.
  handler: renamePrintGroup in fns.ts
  trust: network
- updatePrintGroup: POST server function to update print group.
  handler: updatePrintGroup in fns.ts
  trust: network
- tagPrintCopies: POST server function to tag print copies.
  handler: tagPrintCopies in fns.ts
  trust: network
- untagPrintCopies: POST server function to untag print copies.
  handler: untagPrintCopies in fns.ts
  trust: network
- deletePrintGroup: POST server function to delete print group.
  handler: deletePrintGroup in fns.ts
  trust: network
- reorderPrintGroupItem: POST server function to reorder print group item.
  handler: reorderPrintGroupItem in fns.ts
  trust: network
- reorderRequest: POST server function to reorder request.
  handler: reorderRequest in fns.ts
  trust: network
- updateRequest: POST server function to update request.
  handler: updateRequest in fns.ts
  trust: network
- repeatRequest: POST server function to repeat request.
  handler: repeatRequest in fns.ts
  trust: network
- deleteRequest: POST server function to delete request.
  handler: deleteRequest in fns.ts
  trust: network
- deleteRequests: POST server function to delete requests.
  handler: deleteRequests in fns.ts
  trust: network
- archiveRequests: POST server function to archive requests.
  handler: archiveRequests in fns.ts
  trust: network
- unarchiveRequests: POST server function to unarchive requests.
  handler: unarchiveRequests in fns.ts
  trust: network

## invariants

- mutation origin enforced: The shared mutation wrapper rejects a cookie-authenticated request from another origin before it runs work.
  over: every callback invocation through mutationRpc with a cross-origin request in the server-function test
  via: rejects a cross-origin request before running work
  because: browser cookies accompany cross-site requests, so mutation work must stop before it can change state.
  crossing: network -> verified-identity
  refuted: removed the origin check from mutationRpc -> the cross-origin callback test failed before restore (2026-09-25)
  kinds: identity, state
  checklist: capability-authorization dismissed: this rule checks request origin; account and workspace permissions are checked after it.
  checklist: revalidated-permission dismissed: mutationRpc checks the current request synchronously before running work.
  checklist: canonical-encoding dismissed: the origin helper parses URLs; no persisted identity is encoded here.
  checklist: identity-continuity dismissed: the wrapper does not change the caller's identity.
  checklist: separation-of-duties dismissed: a mutation has no second approver.
  checklist: legal-state-succession dismissed: the wrapper decides entry permission, not a domain state change.
  checklist: supersession-safety dismissed: the wrapper has no delayed publisher.
  checklist: worker-fencing dismissed: the wrapper has no leased worker.
  checklist: commit-ordered-effects dismissed: no external effect precedes the origin decision.
  checklist: resumption-coverage dismissed: this request check does not resume partial work.
- private assets stay private: A requester cannot read another member's private request asset.
  over: the private-board requester case passed through authorizedRequestAsset
  via: hides another requester’s private assets
  because: source models and generated files must obey the same viewer policy as the board.
  crossing: network -> workspace-state
  refuted: returned another requester's private asset -> the private asset access test failed before restore (2026-09-25)
  kinds: read, identity
  checklist: scoped-reads declared as private assets stay private
  checklist: capability-authorization dismissed: this check uses the current session identity and board policy, not a delegated credential.
  checklist: redaction dismissed: unauthorized callers receive no asset rather than a scrubbed representation.
  checklist: canonical-encoding dismissed: no identity encoding is produced by this read.
  checklist: identity-continuity dismissed: the read uses one already resolved identity.
