const PLACEHOLDER_DOMAINS = ['example.com', 'example.net', 'example.org']
const RESERVED_SUFFIXES = new Set(['example', 'invalid', 'local', 'localhost', 'test'])

export const INVALID_PUBLIC_EMAIL_MESSAGE =
  'Please enter a valid email address and check for typing mistakes.'

export function normalizePublicEmail(value) {
  if (typeof value !== 'string') {
    return { email: '', error: INVALID_PUBLIC_EMAIL_MESSAGE }
  }

  const trimmedEmail = value.trim()
  const atIndex = trimmedEmail.lastIndexOf('@')
  if (!trimmedEmail || atIndex <= 0 || atIndex !== trimmedEmail.indexOf('@')) {
    return { email: '', error: INVALID_PUBLIC_EMAIL_MESSAGE }
  }

  const localPart = trimmedEmail.slice(0, atIndex)
  const domain = trimmedEmail.slice(atIndex + 1).toLowerCase()
  const labels = domain.split('.')
  const topLevelDomain = labels[labels.length - 1]
  const validLocalPart =
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(
      localPart
    )

  if (
    trimmedEmail.length > 254 ||
    localPart.length > 64 ||
    !validLocalPart ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-') ||
        !/^[a-z0-9-]+$/i.test(label)
    ) ||
    topLevelDomain.length < 2 ||
    !/[a-z]/i.test(topLevelDomain) ||
    RESERVED_SUFFIXES.has(topLevelDomain) ||
    PLACEHOLDER_DOMAINS.some(
      (placeholder) => domain === placeholder || domain.endsWith(`.${placeholder}`)
    )
  ) {
    return { email: '', error: INVALID_PUBLIC_EMAIL_MESSAGE }
  }

  return {
    email: `${localPart}@${domain}`,
    error: null,
  }
}
