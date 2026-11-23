import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { encodeAudioBufferToWav } from '../src/js/services/audioEngine.js'

// All network/storage dependencies are replaced; these tests cannot contact Supabase.
const userId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const recordingId = '33333333-3333-4333-8333-333333333333'
const listingId = '44444444-4444-4444-8444-444444444444'
const wav = encodeAudioBufferToWav({ numberOfChannels: 1, length: 80000, sampleRate: 16000, getChannelData: () => new Float32Array(80000) })
const preview = { versionId, recordingId, title: 'My voice', blob: wav, startSeconds: 0, durationSeconds: 5 }
const input = { preview, salePrice: '1.99', rentalPrice: '0.50', rightsConfirmed: true, publicConfirmed: true }
const source = new Blob(['private source'], { type: 'audio/webm' })
const ownedVersion = { id: versionId, recording_id: recordingId, storage_path: `${userId}/${versionId}.webm`, file_size_bytes: source.size,
  recording: { id: recordingId, owner_id: userId, title: 'My voice', category: 'Speech', visibility: 'private' } }
const ownListing = { id: listingId, version_id: versionId, status: 'published', preview_path: `${userId}/${listingId}.wav`, version: { effect_type: 'original', recording: ownedVersion.recording } }
const plain = (value) => JSON.parse(JSON.stringify(value))

async function loadService(stubs) {
  const context = createContext({ Blob, console, crypto: webcrypto })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link(async (specifier, parent) => {
      if (Object.hasOwn(stubs, specifier)) {
        const values = stubs[specifier]
        return new SyntheticModule(Object.keys(values), function () {
          Object.entries(values).forEach(([key, value]) => this.setExport(key, value))
        }, { context })
      }
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL('../src/js/services/marketplaceService.js', import.meta.url))
  await module.evaluate()
  return module.namespace
}

async function setup(overrides = {}) {
  const events = []
  const state = { version: ownedVersion, lookups: [null, null], authError: false, rpcError: null, uploadError: null, rpcThrows: false,
    rows: [ownListing], archive: ownListing, updated: { id: listingId, status: 'archived' }, ...overrides }
  let lastPath
  const client = {
    auth: { getUser: async () => { events.push(['auth']); return state.authError ? { error: { message: 'no session' } } : { data: { user: { id: userId } } } } },
    from(table) {
      const filters = []
      let update
      const query = {
        select(fields) { events.push(['select', table, fields]); return this },
        eq(field, value) { filters.push([field, value]); events.push(['eq', table, field, value]); return this },
        update(values) { update = values; events.push(['update', table, values]); return this },
        async maybeSingle() {
          if (table === 'voice_versions') return { data: state.version, error: state.versionError }
          if (filters.some(([field]) => field === 'version_id')) {
            const lookup = state.lookups.shift()
            return { data: lookup === 'matching' ? { id: listingId, version_id: versionId, preview_path: lastPath } : lookup, error: state.lookupError }
          }
          return { data: state.archive }
        },
        async order() { return { data: state.rows, error: state.listError } },
        async single() { assert.deepEqual(plain(update), { status: 'archived' }); return { data: state.updated, error: state.updateError } },
      }
      return query
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'voice-previews')
        return {
          async upload(path, blob, options) {
            events.push(['upload', path, options]); lastPath = path
            assert.equal(blob, wav)
            assert.deepEqual(plain(options), { contentType: 'audio/wav', upsert: false })
            assert.match(path, new RegExp(`^${userId}/[0-9a-f-]{36}\\.wav$`))
            if (state.uploadThrows) throw new Error('Failed to fetch')
            return { error: state.uploadError }
          },
          async remove(paths) { events.push(['remove', paths]); return { data: state.cleanupError ? [] : [{ name: paths[0] }], error: state.cleanupError } },
          getPublicUrl(path) { events.push(['public-url', bucket, path]); return { data: { publicUrl: `https://example.invalid/voice-previews/${path}` } } },
        }
      },
    },
    async rpc(name, args) {
      events.push(['rpc', name, args])
      assert.equal(name, 'publish_voice_listing')
      assert.deepEqual(plain(args), { p_version_id: versionId, p_preview_path: lastPath, p_preview_duration_seconds: 5,
        p_sale_price_cents: 199, p_rental_price_cents: 50, p_make_public: true, p_rights_confirmed: true })
      if (state.rpcThrows) throw new Error('lost connection')
      return { data: state.rpcError ? null : state.rpcData ?? listingId, error: state.rpcError }
    },
  }
  const service = await loadService({
    '../config/supabaseClient.js': { supabase: state.noClient ? null : client, configurationError: 'Missing configuration' },
    './audioEngine.js': { renderPublicPreview: async (blob, options) => {
      events.push(['render', options]); assert.equal(blob, source)
      if (state.renderError) throw new Error('unsupported audio')
      return { blob: wav, startSeconds: options.startSeconds, durationSeconds: options.durationSeconds }
    } },
    './storageService.js': { downloadOriginalAudio: async (path) => { events.push(['download', path]); return state.downloadError ? { error: { message: 'Denied' } } : { blob: source } } },
  })
  return { service, state, events }
}

let test = await setup()
let result = await test.service.prepareListingPreview({ versionId, startSeconds: 0, durationSeconds: 5 })
assert.equal(result.error, null)
assert.equal(result.preview.blob, wav)
assert.equal(result.preview.recordingId, recordingId)
assert.equal(test.events.filter(([event]) => event === 'upload').length, 0)
assert.ok(test.events.find(([event]) => event === 'download'))
for (const override of [{ authError: true }, { version: null }, { version: { ...ownedVersion, recording: { ...ownedVersion.recording, owner_id: listingId } } },
  { lookups: [ownListing] }, { lookupError: { code: '42501' } }, { version: { ...ownedVersion, file_size_bytes: 20971521 } }]) {
  test = await setup(override)
  result = await test.service.prepareListingPreview({ versionId, startSeconds: 0, durationSeconds: 5 })
  assert.ok(result.error)
  assert.equal(test.events.some(([event]) => ['download', 'render', 'upload'].includes(event)), false)
}
for (const override of [{ downloadError: true }, { renderError: true }]) {
  test = await setup(override)
  assert.ok((await test.service.prepareListingPreview({ versionId, startSeconds: 0, durationSeconds: 5 })).error)
}

test = await setup()
result = await test.service.publishVoiceListing(input)
assert.equal(result.error, null)
assert.equal(result.listing.id, listingId)
assert.equal(test.events.filter(([event]) => event === 'upload').length, 1)
assert.equal(test.events.some(([event]) => event === 'remove'), false)
for (const patch of [{ rightsConfirmed: false }, { publicConfirmed: false }, { salePrice: '1e3' }, { preview: { ...preview, durationSeconds: 9 } }]) {
  test = await setup()
  assert.ok((await test.service.publishVoiceListing({ ...input, ...patch })).error)
  assert.equal(test.events.length, 0)
}
test = await setup({ authError: true })
assert.ok((await test.service.publishVoiceListing(input)).error)
assert.equal(test.events.some(([event]) => event === 'upload'), false)
test = await setup({ lookups: [ownListing] })
assert.equal((await test.service.publishVoiceListing(input)).error.code, 'duplicate_listing')
assert.equal(test.events.some(([event]) => event === 'upload'), false)
test = await setup({ uploadError: { message: 'Bucket not found' } })
assert.equal((await test.service.publishVoiceListing(input)).error.code, 'setup_required')
assert.equal(test.events.some(([event]) => event === 'rpc'), false)

test = await setup({ uploadError: { status: 400, statusCode: '403', code: 'AccessDenied', message: 'new row violates row-level security policy' } })
result = await test.service.publishVoiceListing(input)
assert.equal(result.error.stage, 'storage_upload')
assert.equal(result.error.code, 'upload_failed')
assert.equal(result.error.diagnostics.httpStatus, 400)
assert.equal(result.error.diagnostics.storageStatusCode, '403')
assert.equal(result.error.diagnostics.storageCode, 'AccessDenied')
assert.match(result.error.message, /HTTP 400/)
assert.match(result.error.message, /160044 bytes/)
assert.equal(result.error.previewDetails.bucket, 'voice-previews')
assert.equal(result.error.outcomeUnknown, false)
assert.equal(test.events.some(([event]) => ['rpc', 'remove'].includes(event)), false)

test = await setup({ uploadError: { status: 413, statusCode: '413', code: 'EntityTooLarge', message: 'The object exceeded the maximum allowed size' } })
result = await test.service.publishVoiceListing(input)
assert.equal(result.error.diagnostics.httpStatus, 413)
assert.match(result.error.message, /EntityTooLarge/)
assert.equal(test.events.some(([event]) => ['rpc', 'remove'].includes(event)), false)

for (const override of [{ uploadError: { message: 'Failed to fetch', originalError: { headers: { authorization: 'private-session-value' } } } }, { uploadThrows: true }]) {
  test = await setup(override)
  result = await test.service.publishVoiceListing(input)
  assert.equal(result.error.diagnostics.httpStatus, null)
  assert.equal(result.error.outcomeUnknown, true)
  assert.match(result.error.message, /HTTP unavailable/)
  assert.equal(result.error.message.includes('private-session-value'), false)
  assert.equal(test.events.some(([event]) => ['rpc', 'remove'].includes(event)), false)
}
test = await setup({ rpcError: { code: '42501' } })
assert.equal((await test.service.publishVoiceListing(input)).error.code, 'access_denied')
assert.equal(test.events.filter(([event]) => event === 'remove').length, 1)
test = await setup({ rpcError: { code: 'PGRST202' } })
assert.equal((await test.service.publishVoiceListing(input)).error.code, 'setup_required')
test = await setup({ rpcThrows: true })
assert.equal((await test.service.publishVoiceListing(input)).error.outcomeUnknown, true)
assert.equal(test.events.some(([event]) => event === 'remove'), false)
test = await setup({ rpcThrows: true, lookups: [null, 'matching'] })
assert.equal((await test.service.publishVoiceListing(input)).listing.id, listingId)
assert.equal(test.events.some(([event]) => event === 'remove'), false)
test = await setup({ rpcError: { code: '42501' }, lookups: [null, ownListing] })
assert.ok((await test.service.publishVoiceListing(input)).error)
assert.equal(test.events.some(([event]) => event === 'remove'), false)
test = await setup({ rpcError: { code: '42501' }, cleanupError: { message: 'Denied' } })
assert.match((await test.service.publishVoiceListing(input)).error.message, /unused preview/)
test = await setup({ rows: [ownListing, { ...ownListing, version: { recording: { owner_id: listingId } } }] })
assert.equal((await test.service.listMyListings()).listings.length, 1)
test = await setup()
assert.equal((await test.service.archiveMyListing(listingId)).listing.status, 'archived')
assert.equal(test.events.some(([event]) => ['remove', 'upload', 'rpc'].includes(event)), false)
assert.deepEqual(plain(test.events.find(([event]) => event === 'update')[2]), { status: 'archived' })
test = await setup({ archive: null })
assert.equal((await test.service.archiveMyListing(listingId)).error.code, 'access_denied')
assert.equal(test.events.some(([event]) => event === 'update'), false)
test = await setup()
assert.equal(test.service.getPublicPreviewUrl('../voice-files/private.wav'), null)
assert.equal(test.service.getPublicPreviewUrl(`https://example.invalid/${userId}/${listingId}.wav`), null)
assert.match(test.service.getPublicPreviewUrl(ownListing.preview_path), /voice-previews/)
test = await setup({ noClient: true })
assert.equal((await test.service.listMyListings()).error.code, 'configuration')
console.log('Listing service tests passed (ownership/consent gates, private source preparation, separate public uploads, RPC cents, reconciliation, safe cleanup, listing ownership and non-destructive archival).')
