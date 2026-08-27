export const HOSTED_OWNED_WORKSPACE_LIMIT = 3

export type DeploymentType = 'self_hosted' | 'hosted' | 'preview'

export function hostedDeployment() {
  return process.env.STLQUEST_HOSTED?.trim() === 'true'
}

export function deploymentType(): DeploymentType {
  if (process.env.STLQUEST_SEED_PREVIEW?.trim() === 'true') return 'preview'
  return hostedDeployment() ? 'hosted' : 'self_hosted'
}
