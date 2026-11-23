import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Local boundary tests only. SQL tests separately exercise actual DB-time RLS.
const buyerId = '11111111-1111-4111-8111-111111111111'
const licenseId = '22222222-2222-4222-8222-222222222222'
const listingId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'
const sellerId = '55555555-5555-4555-8555-555555555555'
const path = `${sellerId}/${versionId}.webm`
const token = 'SECRET_TOKEN_MUST_NOT_ESCAPE'
const fixture = () => ({
  id: licenseId, buyer_id: buyerId, listing_id: listingId, license_type: 'buy',
  listing: { id: listingId, version_id: versionId, status: 'published', version: {
    id: versionId, storage_path: path, mime_type: 'audio/webm', file_size_bytes: 4,
    recording: { title: '../../A <script> voice' },
  } },
})
let checks = 0
const check = (actual, expected) => { assert.equal(actual, expected); checks++ }

async function setup(overrides = {}) {
  const state = { receipt: fixture(), blob: new Blob(['test'], { type: 'audio/webm;codecs=opus' }), authCalls: 0, ...overrides }
  const events = []
  const client = {
    auth: { async getUser() {
      events.push(['auth'])
      state.authCalls++
      if (state.authThrows) throw new Error(token)
      const id = state.authCalls > 1 && state.switched ? sellerId : buyerId
      return { data: { user: state.signedOut || (state.authCalls > 1 && state.expiredSession) ? null : { id } }, error: state.authError }
    } },
    from(table) {
      check(table, 'licenses')
      const filters = []
      return {
        select(fields) {
          assert.match(fields, /listing:listings\(id,version_id,version:voice_versions\(id,storage_path,mime_type,file_size_bytes/)
          assert.doesNotMatch(fields, /\*|expires_at|!inner/)
          events.push(['select', fields]); return this
        },
        eq(key, value) { filters.push([key, value]); return this },
        async maybeSingle() {
          assert.deepEqual(filters, [['id', licenseId], ['buyer_id', buyerId]])
          if (state.queryThrows) throw new Error(token)
          return { data: state.receipt, error: state.queryError }
        },
      }
    },
    storage: { from(bucket) {
      check(bucket, 'voice-files')
      return { async download(requestedPath) {
        events.push(['download', requestedPath])
        check(requestedPath, state.receipt.listing.version.storage_path)
        if (state.downloadThrows) throw new Error(token)
        return { data: state.blob, error: state.downloadError }
      } }
    } },
  }
  const context = createContext({ Blob })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link(async (specifier, parent) => {
      if (specifier.endsWith('/config/supabaseClient.js')) {
        return new SyntheticModule(['supabase', 'configurationError'], function () {
          this.setExport('supabase', state.noClient ? null : client)
          this.setExport('configurationError', 'Missing Supabase configuration')
        }, { context })
      }
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL('../src/js/services/licensedAudioService.js', import.meta.url))
  await module.evaluate()
  return { state, events, get: module.namespace.getLicensedAudio }
}

for (const licenseType of ['buy', 'rent']) {
  const receipt = fixture()
  receipt.license_type = licenseType
  const service = await setup({ receipt })
  const result = await service.get(licenseId)
  check(result.error, null)
  check(result.audio.blob, service.state.blob)
  check(result.audio.filename, 'A-script-voice.webm')
  check(result.audio.versionId, versionId)
  check(service.state.authCalls, 2)
  assert.deepEqual(Object.keys(result.audio).sort(), ['blob', 'filename', 'title', 'versionId'])
  assert.doesNotMatch(JSON.stringify(result), /voice-files|storage_path|https:|SECRET_TOKEN/)
}

// Archival has no client-side veto; trusted policy decides access.
let receipt = fixture()
receipt.listing.status = 'archived'
let service = await setup({ receipt })
check((await service.get(licenseId)).error, null)

for (const listing of [null, { id: listingId, version_id: versionId, version: null }]) {
  receipt = { ...fixture(), license_type: 'rent', listing }
  service = await setup({ receipt })
  const result = await service.get(licenseId)
  check(result.error.code, 'license_expired')
  check(service.events.filter(([name]) => name === 'download').length, 0)
}

// Missing own license, cross-user, mismatched license/listing/version, unlicensed
// metadata, invalid paths and audio formats all fail before private Storage.
for (const change of [
  () => null,
  (row) => ({ ...row, buyer_id: sellerId }),
  (row) => ({ ...row, id: sellerId }),
  (row) => ({ ...row, license_type: 'forged' }),
  (row) => { row.listing.id = sellerId; return row },
  (row) => { row.listing.version.id = sellerId; return row },
  (row) => { row.listing.version = null; return row },
  (row) => { row.listing.version.storage_path = `https://evil.invalid/${token}`; return row },
  (row) => { row.listing.version.storage_path = `${sellerId}/../private.wav`; return row },
  (row) => { row.listing.version.storage_path = `${sellerId}/${versionId}.wav`; return row },
  (row) => { row.listing.version.mime_type = 'text/html'; return row },
  (row) => { row.listing.version.file_size_bytes = 0; return row },
  (row) => { row.listing.version.file_size_bytes = 20971521; return row },
]) {
  service = await setup({ receipt: change(fixture()) })
  const result = await service.get(licenseId)
  check(result.audio, null)
  assert.ok(result.error)
  assert.doesNotMatch(result.error.message, /SECRET_TOKEN|evil\.invalid|storage_path/)
  check(service.events.filter(([name]) => name === 'download').length, 0)
}

for (const options of [{ signedOut: true }, { authError: { message: token } }, { authThrows: true }, { noClient: true }]) {
  service = await setup(options)
  const result = await service.get(licenseId)
  check(result.audio, null)
  check(service.events.filter(([name]) => name === 'select').length, 0)
}
service = await setup()
check((await service.get({ id: licenseId, path, buyerId })).error.code, 'invalid_license')
check(service.events.length, 0)

// MIME parameters and stored WebM/WEBA extensions survive downloads. No WAV
// conversion or renaming of compressed originals is performed.
for (const [mime, extension] of [['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'], ['audio/ogg', 'ogg'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'weba']]) {
  receipt = fixture()
  Object.assign(receipt.listing.version, { storage_path: `${sellerId}/${versionId}.${extension}`, mime_type: mime })
  service = await setup({ receipt, blob: new Blob(['test'], { type: mime }) })
  const result = await service.get(licenseId)
  check(result.error, null)
  assert.ok(result.audio.filename.endsWith(`.${extension}`))
  check(await result.audio.blob.text(), 'test')
}
for (const type of ['', 'application/octet-stream']) {
  service = await setup({ blob: new Blob(['test'], { type }) })
  check((await service.get(licenseId)).audio.blob.type, 'audio/webm')
}
for (const blob of [null, new Blob([]), new Blob(['te']), new Blob(['test'], { type: 'text/html' }), new Blob(['test'], { type: 'audio/wav' })]) {
  service = await setup({ blob })
  check((await service.get(licenseId)).audio, null)
}

for (const [options, code] of [
  [{ queryError: { status: 401, message: token } }, 'authentication_required'],
  [{ queryError: { code: '42501', message: token } }, 'access_denied'],
  [{ queryThrows: true }, 'download_failed'],
  [{ downloadError: { statusCode: '403', message: token } }, 'access_denied'],
  [{ downloadError: { statusCode: '400', message: token } }, 'file_unavailable'],
  [{ downloadError: { status: 404, message: token } }, 'file_unavailable'],
  [{ downloadError: { status: 500, message: token } }, 'download_failed'],
  [{ downloadThrows: true }, 'download_failed'],
  [{ switched: true }, 'authentication_required'],
  [{ expiredSession: true }, 'authentication_required'],
]) {
  service = await setup(options)
  let result = await service.get(licenseId)
  check(result.audio, null)
  check(result.error.code, code)
  assert.doesNotMatch(JSON.stringify(result), /SECRET_TOKEN|voice-files|storage_path|token=/)
  Object.assign(service.state, { queryError: null, queryThrows: false, downloadError: null,
    downloadThrows: false, switched: false, expiredSession: false })
  result = await service.get(licenseId)
  check(result.error, null)
}

const source = await readFile(new URL('../src/js/services/licensedAudioService.js', import.meta.url), 'utf8')
assert.doesNotMatch(source, /createSignedUrl|getPublicUrl|localStorage|sessionStorage|Date\.now|new Date|console\.|service_role|serviceRole/)
console.log(`Licensed audio service PASS (${checks} boundary assertions; no live database claims).`)
