import type { PostHogConfig } from 'posthog-js'
import { ingestPath, serviceName, type PostHogEnvironment } from '../contracts/posthog'
import { dropDuplicateServerFunctionException, dropExpectedStorageProblems, dropOpaqueScriptError } from './telemetry'
import { appPath } from '../basePath'

/** Browser SDK options; `defaults` pins the SDK's behavior to a dated snapshot, so raise it only after reading what changed. */
export function postHogOptions(environment: PostHogEnvironment, hostname: string, mode = import.meta.env.MODE): Partial<PostHogConfig> {
  const service = { serviceName: `${serviceName}-web`, serviceVersion: __APP_VERSION__, environment: mode }
  return {
    api_host: appPath(ingestPath),
    ui_host: environment.uiHost,
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    before_send: [dropExpectedStorageProblems, dropDuplicateServerFunctionException, dropOpaqueScriptError],
    capture_exceptions: { capture_console_errors: false, capture_unhandled_errors: true, capture_unhandled_rejections: true },
    capture_performance: true,
    mask_personal_data_properties: true,
    // Password reset and invitation links carry their secret in `token`.
    custom_personal_data_properties: ['token'],
    // Workspaces hold people's names, filenames, and notes, so replay and autocapture record no text or attributes.
    mask_all_element_attributes: true,
    mask_all_text: true,
    session_recording: { maskAllInputs: true, blockSelector: '.ph-no-capture' },
    // Only this origin's requests carry the person and session headers, so no third party learns them.
    tracing_headers: [hostname],
    logs: service,
    metrics: service,
  }
}
