import type { Messages } from './i18n'
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 256

export function passwordLengthError(password: string, t: Messages) {
  return password.length >= PASSWORD_MIN_LENGTH ? undefined : t.auth.passwordTooShort(PASSWORD_MIN_LENGTH)
}
