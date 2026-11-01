export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export const MAX_USER_NAME_LENGTH = 100

/** Cuts a name to the limit by characters, so a long name from a sign-in provider or an API call cannot split one. */
export function boundedUserName(name: string) {
  const characters = Array.from(name)
  return characters.length > MAX_USER_NAME_LENGTH ? characters.slice(0, MAX_USER_NAME_LENGTH).join('') : name
}
