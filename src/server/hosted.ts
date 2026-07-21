export function hostedDeployment() {
  return process.env.STLQUEST_HOSTED?.trim() === 'true'
}
