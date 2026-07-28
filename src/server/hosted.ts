export const HOSTED_OWNED_WORKSPACE_LIMIT = 3

export function hostedDeployment() {
  return process.env.STLQUEST_HOSTED?.trim() === 'true'
}
