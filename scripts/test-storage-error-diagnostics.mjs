import assert from 'node:assert/strict'
import { describeStorageUploadError, formatStorageUploadDiagnostics } from '../src/js/utils/storageErrorDiagnostics.js'

let result = formatStorageUploadDiagnostics({
  status: 400, statusCode: '403', code: 'AccessDenied',
  message: 'new row violates row-level security policy for table "objects"',
})
assert.deepEqual(result.diagnostics, {
  httpStatus: 400, storageStatusCode: '403', storageCode: 'AccessDenied',
  message: 'The upload was denied by row-level security.',
})
assert.match(result.summary, /HTTP 400; Storage status 403; Storage code AccessDenied/)

result = formatStorageUploadDiagnostics({ statusCode: '403', code: 'Unauthorized', message: 'Unauthorized' })
assert.equal(result.diagnostics.httpStatus, null)
assert.equal(result.diagnostics.storageStatusCode, '403')
assert.match(result.summary, /^HTTP unavailable;/)
assert.doesNotMatch(result.summary, /HTTP 403/)

const messages = [
  ['permission denied for function can_upload_voice_preview', /authorization function/],
  ['Bucket not found', /bucket not found/],
  ['mime type audio/wav is not supported', /MIME type/],
  ['The object exceeded the maximum allowed size', /file size/],
  ['JWT token expired', /invalid or expired/],
  ['The resource already exists', /already exists/],
  ['Failed to fetch', /could not complete/],
]
for (const [message, expected] of messages) assert.match(describeStorageUploadError({ message }).message, expected)
assert.match(describeStorageUploadError({ code: '42501', message: 'permission denied for function can_upload_voice_preview' }).message, /authorization function/)
assert.equal(describeStorageUploadError({ code: '42501' }).message, 'Storage access was denied.')

const sensitive = [
  'Bearer shortSensitiveCredential',
  'Authorization: Bearer headerCredential\r\napikey=apiCredential',
  '{"password":"p@ssword","access_token":"accessCredential","refresh_token":"refreshCredential"}',
  'https://example.invalid/storage/v1/object/sign/private/file.wav?token=signedCredential&apikey=queryCredential',
  'sb_secret_secretCredential sb_publishable_publishableCredential',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.credentialSignature123',
  '<script>const password="htmlCredential"</script>',
  'opaqueCredentialWithoutLabel1234567890ABCD',
]
for (const value of sensitive) {
  for (const prefix of ['', 'new row violates row-level security policy; ']) {
    const diagnostic = formatStorageUploadDiagnostics({
      status: 403, statusCode: '403', code: 'AccessDenied', message: prefix + value,
      originalError: { message: value }, stack: value, headers: { Authorization: value }, response: value,
    })
    const output = JSON.stringify(diagnostic)
    assert.ok(output.length < 500)
    assert.doesNotMatch(output, /Credential|p@ssword|example\.invalid|eyJhbGci|sb_secret_|sb_publishable_|<script>/)
    assert.doesNotMatch(diagnostic.summary, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/)
    assert.deepEqual(Object.keys(diagnostic.diagnostics), ['httpStatus', 'storageStatusCode', 'storageCode', 'message'])
  }
}

for (const value of ['sb_secret_secretCredential', 'Bearer secret', 'PrivateCredential', 'https://example.invalid/token', 'A'.repeat(100),
  'PASSWORDSECRETCREDENTIAL123456', 'AccessDenied\nAuthorization=secret']) {
  assert.equal(describeStorageUploadError({ code: value }).storageCode, null)
}
for (const value of [0, 99, 600, NaN, Infinity, '403 cookie=secret', {}, null]) {
  const diagnostic = describeStorageUploadError({ status: value, statusCode: value })
  assert.equal(diagnostic.httpStatus, null)
  assert.equal(diagnostic.storageStatusCode, null)
}

assert.equal(describeStorageUploadError(new TypeError('Failed to fetch')).httpStatus, null)
assert.equal(describeStorageUploadError(null).httpStatus, null)
assert.equal(describeStorageUploadError({ message: { token: 'hidden' } }).message, 'No readable Storage response details were available.')
const throwingFields = Object.defineProperties({}, {
  status: { get() { throw new Error('do not expose getter details') } },
  message: { get() { throw new Error('do not expose getter details') } },
})
assert.equal(describeStorageUploadError(throwingFields).httpStatus, null)
assert.equal(describeStorageUploadError(throwingFields).message, 'No readable Storage response details were available.')

console.log('Storage diagnostics tests passed (HTTP versus service status, safe error summaries, credential suppression, unknown/transport errors).')
