import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'

// Isolate network dependencies; these tests never contact Supabase or touch user data.
async function loadService(name, stubs) {
  const context = createContext({ Blob, Error, console, crypto: webcrypto })
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
  const module = await load(new URL(`../src/js/services/${name}.js`, import.meta.url))
  await module.evaluate()
  return module.namespace
}

const recordingId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const sourceBlob = new Blob(['original'], { type: 'audio/webm' })
const wav = new Blob(['rendered WAV'], { type: 'audio/wav' })
const path = `${userId}/33333333-3333-4333-8333-333333333333.wav`
const rendered = { blob: wav, durationSeconds: 1.25, effectType: 'echo', effectSettings: { intensity: 70 } }
const version = { id: 'version-id', storage_path: path }
const input = { recordingId, sourceBlob, effectType: 'echo', intensity: 70 }

async function runSave(overrides = {}) {
  const calls = []
  const behavior = {
    premium: { premium: true, error: null },
    upload: { path, error: null },
    insert: { version, error: null },
    verify: { version: null, error: null },
    cleanup: { removed: true, error: null },
    ...overrides,
  }
  const service = await loadService('editedVersionService', {
    './subscriptionService.js': { getPremiumEligibility: async () => { calls.push('premium'); return behavior.premium } },
    './audioEngine.js': { renderAudioWav: async (blob, settings) => {
      calls.push('render')
      assert.equal(blob, sourceBlob)
      assert.equal(settings.effectType, 'echo')
      assert.equal(settings.intensity, 70)
      if (behavior.renderError) throw new Error(behavior.renderError)
      return rendered
    } },
    './storageService.js': {
      uploadEditedAudio: async (blob) => { calls.push('upload'); assert.equal(blob, wav); return behavior.upload },
      removeUnreferencedAudio: async (value) => { calls.push('cleanup'); assert.equal(value, path); return behavior.cleanup },
    },
    './voiceRecordingService.js': {
      createEditedVersion: async (metadata) => {
        calls.push('insert')
        assert.equal(metadata.recordingId, recordingId)
        assert.equal(metadata.storagePath, path)
        assert.equal(metadata.blob, wav)
        assert.equal(metadata.effectSettings.intensity, 70)
        return behavior.insert
      },
      findOwnedEditedVersionByPath: async (value) => { calls.push('verify'); assert.equal(value, path); return behavior.verify },
    },
  })
  return { result: await service.saveEditedAudio(input), calls }
}

let saved = await runSave({ premium: { premium: false, error: null } })
assert.deepEqual(saved.calls, ['premium'])
assert.match(saved.result.error.message, /Premium/)
saved = await runSave({ premium: { premium: false, error: 'Cannot verify access' } })
assert.deepEqual(saved.calls, ['premium'])
saved = await runSave()
assert.equal(saved.result.version, version)
assert.deepEqual(saved.calls, ['premium', 'render', 'upload', 'insert'])
saved = await runSave({ renderError: 'Unsupported audio format' })
assert.deepEqual(saved.calls, ['premium', 'render'])
assert.match(saved.result.error.message, /Unsupported/)

const denied = { version: null, error: { message: 'Denied by RLS', outcomeUnknown: false } }
saved = await runSave({ insert: denied })
assert.deepEqual(saved.calls, ['premium', 'render', 'upload', 'insert', 'verify', 'cleanup'])
assert.equal(saved.result.error.outcomeUnknown, false)
saved = await runSave({ insert: { version: null, error: { message: 'Lost response', outcomeUnknown: true } } })
assert.equal(saved.result.error.outcomeUnknown, true)
assert.ok(!saved.calls.includes('cleanup'), 'An uncertain commit must retain its file')
saved = await runSave({ insert: denied, verify: { version, error: null } })
assert.equal(saved.result.version, version)
assert.ok(!saved.calls.includes('cleanup'))
saved = await runSave({ insert: denied, verify: { version: null, error: { message: 'Offline' } } })
assert.equal(saved.result.error.outcomeUnknown, true)
assert.ok(!saved.calls.includes('cleanup'))
saved = await runSave({ insert: denied, cleanup: { removed: false } })
assert.equal(saved.result.error.outcomeUnknown, true)
saved = await runSave({ upload: { path, error: { message: 'Upload lost response', outcomeUnknown: true } } })
assert.deepEqual(saved.calls, ['premium', 'render', 'upload', 'verify', 'cleanup'])

let authAllowed = true
let premiumData = true
let rpcError = null
const rpcCalls = []
const client = {
  auth: { getUser: async () => ({ data: { user: authAllowed ? { id: userId } : null }, error: null }) },
  rpc: async (name) => { rpcCalls.push(name); return { data: premiumData, error: rpcError } },
}
const subscription = await loadService('subscriptionService', {
  '../config/supabaseClient.js': { supabase: client, configurationError: null },
})
assert.equal((await subscription.getPremiumEligibility()).premium, true)
assert.equal(rpcCalls[0], 'has_active_premium')
premiumData = false
assert.equal((await subscription.getPremiumEligibility()).premium, false)
premiumData = 'true'
assert.ok((await subscription.getPremiumEligibility()).error, 'Malformed eligibility must fail closed')
rpcError = { code: 'PGRST202' }
assert.ok((await subscription.getPremiumEligibility()).error)
authAllowed = false
const rpcCount = rpcCalls.length
assert.equal((await subscription.getPremiumEligibility()).premium, false)
assert.equal(rpcCalls.length, rpcCount, 'Anonymous access must not call the Premium RPC')

authAllowed = true
let inserted = null
let insertError = null
client.from = (table) => ({
  insert: (row) => {
    assert.equal(table, 'voice_versions')
    inserted = row
    return { select: () => ({ single: async () => ({ data: insertError ? null : version, error: insertError }) }) }
  },
})
const metadataService = await loadService('voiceRecordingService', {
  '../config/supabaseClient.js': { supabase: client, configurationError: null },
})
const metadata = { ...rendered, recordingId, storagePath: path }
assert.equal((await metadataService.createEditedVersion(metadata)).version, version)
assert.equal(inserted.recording_id, recordingId)
assert.equal(inserted.effect_type, 'echo')
assert.equal(inserted.mime_type, 'audio/wav')
assert.equal(inserted.effect_settings.intensity, 70)
assert.equal(inserted.file_size_bytes, wav.size)
inserted = null
assert.ok((await metadataService.createEditedVersion({ ...metadata, storagePath: 'other-owner/file.wav' })).error)
assert.equal(inserted, null)
assert.ok((await metadataService.createEditedVersion({ ...metadata, effectType: 'original' })).error)
assert.equal(inserted, null)
insertError = { code: '42501', status: 403 }
const rejected = await metadataService.createEditedVersion(metadata)
assert.equal(rejected.error.code, 'access_denied')
assert.equal(rejected.error.outcomeUnknown, false)
insertError = { status: 503 }
assert.equal((await metadataService.createEditedVersion(metadata)).error.outcomeUnknown, true)
client.rpc = async () => ({ data: null, error: { code: '22023', status: 400 } })
const originalRejected = await metadataService.createOriginalRecording({
  blob: wav, durationSeconds: 1, title: 'Disposable original', category: 'Test', storagePath: path,
})
assert.equal(originalRejected.error.code, 'invalid_recording')
assert.equal(originalRejected.error.outcomeUnknown, false, 'A definitive original-save rejection must remain safely retryable')

const uploads = []
client.storage = { from: (bucket) => ({ upload: async (name, blob, options) => {
  uploads.push({ bucket, name, blob, options })
  return { error: null }
} }) }
const storage = await loadService('storageService', {
  '../config/supabaseClient.js': { supabase: client, configurationError: null },
})
await storage.uploadEditedAudio(wav)
await storage.uploadEditedAudio(wav)
assert.equal(uploads.length, 2)
assert.equal(uploads[0].bucket, 'voice-files')
assert.ok(uploads[0].name.startsWith(`${userId}/`))
assert.ok(uploads[0].name.endsWith('.wav'))
assert.notEqual(uploads[0].name, uploads[1].name)
assert.equal(uploads[0].options.upsert, false)
assert.equal(uploads[0].options.contentType, 'audio/wav')
assert.ok((await storage.uploadEditedAudio(sourceBlob)).error)
assert.equal(uploads.length, 2)

console.log('Prompt 12 edited save, subscription, metadata, and private upload tests passed (no network).')
