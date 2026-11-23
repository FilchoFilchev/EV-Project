import assert from 'node:assert/strict'
import { encodeAudioBufferToWav } from '../src/js/services/audioEngine.js'
import { parseEuroPrice, validateListingOptions, validatePreviewSelection, validatePublicPreview } from '../src/js/utils/listingValidation.js'

for (const [input, cents] of [['', null], ['  ', null], ['0.01', 1], ['1', 100], ['1.1', 110], ['12,34', 1234], ['21474836.47', 2147483647]]) {
  assert.deepEqual(parseEuroPrice(input), { cents, error: null })
}
for (const input of [null, 1.2, '0', '0.00', '-1', '+1', '1e2', 'Infinity', '1.001', '.50', '1.', '1,2.3', '21474836.48', '9999999999', '€2']) {
  assert.ok(parseEuroPrice(input).error, `reject ${String(input)}`)
}
const valid = { salePrice: '1.99', rentalPrice: '', rightsConfirmed: true, publicConfirmed: true }
assert.deepEqual(validateListingOptions(valid), { salePriceCents: 199, rentalPriceCents: null, error: null })
assert.equal(validateListingOptions({ ...valid, salePrice: '', rentalPrice: '0.50' }).rentalPriceCents, 50)
for (const patch of [{ salePrice: '' }, { salePrice: '1.234' }, { rentalPrice: '-1' }, { rightsConfirmed: false }, { publicConfirmed: false }, { rightsConfirmed: 'true' }]) {
  assert.ok(validateListingOptions({ ...valid, ...patch }).error)
}
assert.equal(validatePreviewSelection(0, 5), null)
assert.equal(validatePreviewSelection(1.25, 8), null)
assert.equal(validatePreviewSelection(0, 5.001), null)
for (const [start, duration] of [[-1, 5], [Infinity, 5], [0, 4.999], [0, 8.001], [0, NaN], [0, 5.0001], ['0', 5]]) {
  assert.ok(validatePreviewSelection(start, duration))
}
const buffer = { numberOfChannels: 1, length: 80000, sampleRate: 16000, getChannelData: () => new Float32Array(80000) }
const wav = encodeAudioBufferToWav(buffer)
assert.equal(await validatePublicPreview(wav, 5), null)
assert.ok(await validatePublicPreview(wav, 6))
assert.ok(await validatePublicPreview(new Blob([await wav.arrayBuffer()], { type: 'audio/mpeg' }), 5))
assert.ok(await validatePublicPreview(new Blob([new Uint8Array(wav.size)], { type: 'audio/wav' }), 5))
for (const [offset, value] of [[22, 2], [24, 8000], [28, 16000], [32, 4], [34, 8], [40, 10]]) {
  const bytes = await wav.arrayBuffer()
  new DataView(bytes).setUint16(offset, value, true)
  assert.ok(await validatePublicPreview(new Blob([bytes], { type: 'audio/wav' }), 5), `reject forged header ${offset}`)
}
assert.ok(await validatePublicPreview({ type: 'audio/wav', size: wav.size, arrayBuffer: async () => new ArrayBuffer(2) }, 5))
console.log('Listing validation tests passed (integer EUR cents, licensing options/consent, duration, canonical WAV header and exact size).')
