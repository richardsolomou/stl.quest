export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256

export function passwordLengthError(password: string) {
  return password.length >= PASSWORD_MIN_LENGTH ? undefined : `Use at least ${PASSWORD_MIN_LENGTH} characters`
}
