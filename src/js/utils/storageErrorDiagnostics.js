// Return only scalar diagnostic fields. Never serialize an SDK error: its
// originalError, response, headers, stack, or free-form message can hold secrets.
function scalarField(error, field) {
  try {
    const value = error?.[field]
    return typeof value === 'string' || typeof value === 'number' ? value : null
  } catch {
    return null
  }
}

function httpStatus(value) {
  if (typeof value === 'string' && !/^[1-5][0-9]{2}$/.test(value)) return null
  const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
}

const STORAGE_CODES = new Set([
  'AccessDenied', 'Unauthorized', 'InvalidJWT', 'ExpiredToken', 'InvalidToken',
  'InvalidSignature', 'SignatureDoesNotMatch', 'EntityTooLarge', 'InvalidMimeType',
  'NoSuchBucket', 'NoSuchKey', 'NoSuchUpload', 'KeyAlreadyExists', 'ResourceAlreadyExists',
  'ResourceLocked', 'InternalError', 'DatabaseError', 'DatabaseTimeout', 'InvalidRequest',
  'InvalidRange', 'InvalidBucketName', 'InvalidKey', 'InvalidUploadId', 'InvalidUploadSignature',
  'InvalidOwner', 'InvalidFileSize', 'InvalidParameter', 'InvalidChecksum', 'ContentLengthMismatch',
  'NoContentProvided', 'TooManyRequests', 'TenantNotFound', 'NotFound', 'Timeout', 'RequestTimeout',
  'SlowDown', 'Duplicate', 'S3Error',
])

function storageCode(value) {
  // Error codes are allowlisted too: arbitrary short text can itself be a key.
  return typeof value === 'string' && (STORAGE_CODES.has(value) || /^[0-9A-Z]{5}$/.test(value))
    ? value
    : null
}

function safeMessage(error, code, status) {
  const raw = scalarField(error, 'message')
  const message = typeof raw === 'string'
    ? raw.slice(0, 4096).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ')
    : ''
  // These patterns select fixed descriptions; no part of the input is echoed.
  // Credentials remain suppressed even when appended to an otherwise valid
  // error, embedded in HTML/URLs, or supplied without an identifying label.
  if (/row[- ]level security|\brls\b/i.test(message)) {
    return 'The upload was denied by row-level security.'
  }
  if (/permission denied for function/i.test(message)) {
    return 'Permission was denied for a Storage authorization function.'
  }
  if (/bucket.*(?:not found|does not exist)|no such bucket/i.test(message) || code === 'NoSuchBucket') {
    return 'Storage bucket not found.'
  }
  if (/mime|content[- ]type|unsupported media/i.test(message) || code === 'InvalidMimeType') {
    return 'The upload MIME type was not allowed.'
  }
  if (/too large|exceed.{0,30}(?:size|limit)|maximum allowed size|payload/i.test(message) || code === 'EntityTooLarge') {
    return 'The upload exceeded the allowed file size.'
  }
  if (/expired|invalid.{0,20}(?:jwt|token)|invalid signature/i.test(message) ||
      ['InvalidJWT', 'ExpiredToken', 'InvalidToken', 'InvalidSignature'].includes(code)) {
    return 'Storage authentication was invalid or expired.'
  }
  if (/already exists|duplicate/i.test(message) || ['KeyAlreadyExists', 'ResourceAlreadyExists'].includes(code)) {
    return 'An object already exists at the upload path.'
  }
  if (/permission denied|access denied|not authorized|unauthorized/i.test(message) ||
      ['AccessDenied', 'Unauthorized', '42501'].includes(code)) {
    return 'Storage access was denied.'
  }
  if (/failed to fetch|fetch failed|network|load failed|cors/i.test(message)) {
    return 'The browser could not complete the Storage upload request.'
  }
  return status === null ? 'No readable Storage response details were available.' : 'Storage rejected the upload.'
}

export function describeStorageUploadError(error) {
  // Do not infer an HTTP response from statusCode: Storage can return HTTP 400
  // while its response body reports statusCode 403.
  const status = httpStatus(scalarField(error, 'status'))
  const legacyStatus = httpStatus(scalarField(error, 'statusCode'))
  const code = storageCode(scalarField(error, 'code'))
  return {
    httpStatus: status,
    storageStatusCode: legacyStatus === null ? null : String(legacyStatus),
    storageCode: code,
    message: safeMessage(error, code, status),
  }
}

export function formatStorageUploadDiagnostics(error) {
  const diagnostics = describeStorageUploadError(error)
  const details = [diagnostics.httpStatus === null ? 'HTTP unavailable' : `HTTP ${diagnostics.httpStatus}`]
  if (diagnostics.storageStatusCode !== null) details.push(`Storage status ${diagnostics.storageStatusCode}`)
  if (diagnostics.storageCode !== null) details.push(`Storage code ${diagnostics.storageCode}`)
  details.push(diagnostics.message)
  return { diagnostics, summary: details.join('; ') }
}
