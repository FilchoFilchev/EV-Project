import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { webcrypto } from 'node:crypto'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { StorageClient } from '@supabase/storage-js'
import { encodeAudioBufferToWav } from '../src/js/services/audioEngine.js'
import { validatePublicPreview } from '../src/js/utils/listingValidation.js'

// Uses the installed Storage SDK, but every request terminates in this fake fetch.
// No environment file, real credentials, remote bucket, or user data is accessed.
const authenticatedUser = { id: '11111111-1111-4111-8111-111111111111' }
const fileId = '22222222-2222-4222-8222-222222222222'
const recordingId = '33333333-3333-4333-8333-333333333333'
const objectPath = `${authenticatedUser.id}/${fileId}.wav`
const uploadOptions = { contentType: 'audio/wav', upsert: false }
const requestEvents = []

function wavAt(seconds, sampleRate = 16000) {
  const samples = new Float32Array(seconds * sampleRate)
  samples[0] = 0.25
  samples[samples.length - 1] = -0.25
  return encodeAudioBufferToWav({
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    getChannelData: () => samples,
  })
}

function storageWithFakeFetch(respond) {
  return new StorageClient('https://example.invalid/storage/v1', {}, async (url, options) => {
    assert.equal(new URL(url).origin, 'https://example.invalid')
    assert.equal(new URL(url).pathname, `/storage/v1/object/voice-previews/${objectPath}`)
    assert.equal(objectPath.split('/')[0], authenticatedUser.id)
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['x-upsert'], 'false')
    assert.ok(options.body instanceof FormData)
    const file = options.body.get('')
    assert.equal(file.type, 'audio/wav')
    requestEvents.push({ size: file.size, mime: file.type, file })
    return respond(file)
  })
}

for (const seconds of [5, 8]) {
  const wav = wavAt(seconds)
  assert.equal(wav.size, 44 + seconds * 32000)
  assert.equal(await validatePublicPreview(wav, seconds), null)
  const client = storageWithFakeFetch(async (file) => {
    assert.equal(file.size, seconds === 5 ? 160044 : 256044)
    const bytes = await file.arrayBuffer()
    assert.deepEqual(bytes, await wav.arrayBuffer(), 'SDK must preserve WAV bytes in the multipart file')
    const header = new DataView(bytes)
    const text = (offset, length) => String.fromCharCode(...new Uint8Array(bytes, offset, length))
    assert.equal(text(0, 4), 'RIFF')
    assert.equal(text(8, 4), 'WAVE')
    assert.equal(text(36, 4), 'data')
    assert.equal(header.getUint16(20, true), 1, 'PCM encoding')
    assert.equal(header.getUint16(22, true), 1, 'mono')
    assert.equal(header.getUint32(24, true), 16000)
    assert.equal(header.getUint32(28, true), 32000)
    assert.equal(header.getUint16(32, true), 2)
    assert.equal(header.getUint16(34, true), 16)
    assert.equal(header.getUint32(40, true), seconds * 32000)
    assert.equal(header.getInt16(44, true), 8192)
    return new Response(JSON.stringify({ Id: fileId, Key: `voice-previews/${objectPath}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  const result = await client.from('voice-previews').upload(objectPath, wav, uploadOptions)
  assert.equal(result.error, null)
  assert.equal(result.data.path, objectPath)
}

// HTTP status and the legacy statusCode in a Storage response can differ.
const rejected = storageWithFakeFetch(() => new Response(JSON.stringify({
  statusCode: '403', code: 'AccessDenied', message: 'new row violates row-level security policy',
}), { status: 400, headers: { 'content-type': 'application/json' } }))
const rejectedResult = await rejected.from('voice-previews').upload(objectPath, wavAt(5), uploadOptions)
assert.equal(rejectedResult.error.status, 400)
assert.equal(rejectedResult.error.statusCode, '403')
assert.equal(rejectedResult.error.code, 'AccessDenied')
assert.equal(rejectedResult.error.message, 'new row violates row-level security policy')

const disconnected = storageWithFakeFetch(() => { throw new TypeError('Local fake network disconnect') })
const disconnectedResult = await disconnected.from('voice-previews').upload(objectPath, wavAt(5), uploadOptions)
assert.ok(disconnectedResult.error)
assert.equal(disconnectedResult.error.status, undefined, 'No HTTP response means no HTTP status')
assert.equal(disconnectedResult.error.statusCode, undefined)
assert.equal(disconnectedResult.error.code, undefined)

// Load the actual publication service with network dependencies replaced. An
// oversized 44.1/48 kHz preview must fail BEFORE authentication or SDK upload.
let unexpectedBoundaryCalls = 0
const forbiddenBoundary = () => {
  unexpectedBoundaryCalls += 1
  throw new Error('Invalid WAV must not reach an authentication/network boundary')
}
const context = createContext({ Blob, console, crypto: webcrypto })
const cache = new Map()
const stubs = {
  '../config/supabaseClient.js': {
    configurationError: null,
    supabase: { auth: { getUser: forbiddenBoundary }, storage: { from: forbiddenBoundary } },
  },
}
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
const service = await load(new URL('../src/js/services/marketplaceService.js', import.meta.url))
await service.evaluate()
for (const sampleRate of [44100, 48000]) {
  for (const seconds of [5, 8]) {
    const blob = wavAt(seconds, sampleRate)
    assert.ok(blob.size > 256044)
    const result = await service.namespace.publishVoiceListing({
      preview: { versionId: fileId, recordingId, blob, durationSeconds: seconds },
      salePrice: '1.00', rentalPrice: '', rightsConfirmed: true, publicConfirmed: true,
    })
    assert.equal(result.error?.code, 'invalid_preview')
    assert.equal(result.listing, null)
  }
}
assert.equal(unexpectedBoundaryCalls, 0)
assert.equal(requestEvents.length, 4, 'Only explicit SDK cases may invoke the local fake fetch')
console.log('Preview upload request tests passed (8 cases: 5/8-second canonical multipart WAVs, HTTP/storage error fields, transport failure, and 44.1/48 kHz rejection before upload; fake fetch only, no network).')
