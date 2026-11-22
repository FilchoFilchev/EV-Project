import assert from 'node:assert/strict'
import {
  MAX_AUDIO_FILE_SIZE_BYTES,
  normalizeAudioMimeType,
  validateOriginalAudio,
} from '../src/js/utils/audioUploadValidation.js'

assert.deepEqual(normalizeAudioMimeType('audio/webm;codecs=opus'), {
  mimeType: 'audio/webm',
  extension: 'webm',
})
assert.deepEqual(normalizeAudioMimeType('AUDIO/X-WAV'), {
  mimeType: 'audio/x-wav',
  extension: 'wav',
})
for (const [mimeType, extension] of [
  ['audio/wav', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/ogg', 'ogg'],
  ['audio/webm;codecs=opus', 'webm'],
]) {
  assert.deepEqual(normalizeAudioMimeType(mimeType), {
    mimeType: mimeType.split(';', 1)[0],
    extension,
  })
}
assert.equal(normalizeAudioMimeType('audio/aac'), null)

const validInput = {
  blob: { size: 1024, type: 'audio/webm;codecs=opus' },
  durationSeconds: 1.25,
  title: '  Voice note  ',
  category: '  Personal  ',
  description: '  Local recording  ',
}
assert.deepEqual(validateOriginalAudio(validInput), {
  error: null,
  title: 'Voice note',
  category: 'Personal',
  description: 'Local recording',
  mimeType: 'audio/webm',
  extension: 'webm',
  fileSizeBytes: 1024,
  durationSeconds: 1.25,
})

assert.equal(
  validateOriginalAudio({ ...validInput, blob: { size: 0, type: 'audio/webm' } }).error,
  'Choose a non-empty audio recording or file before saving.'
)
assert.equal(
  validateOriginalAudio({
    ...validInput,
    blob: { size: MAX_AUDIO_FILE_SIZE_BYTES + 1, type: 'audio/webm' },
  }).error,
  'Audio files must be 20 MiB or smaller.'
)
assert.equal(
  validateOriginalAudio({
    ...validInput,
    blob: { size: MAX_AUDIO_FILE_SIZE_BYTES, type: 'audio/webm' },
  }).error,
  null
)
assert.equal(
  validateOriginalAudio({ ...validInput, blob: { size: 10, type: 'audio/aac' } }).error,
  'This audio format cannot be saved. Choose WAV, MP3, M4A, OGG, or WebM audio supported by your browser.'
)
assert.equal(
  validateOriginalAudio({ ...validInput, durationSeconds: Number.NaN }).error,
  'The audio duration could not be read. Play or reselect the audio, then try again.'
)
assert.equal(
  validateOriginalAudio({ ...validInput, durationSeconds: Infinity }).error,
  'The audio duration could not be read. Play or reselect the audio, then try again.'
)
assert.equal(
  validateOriginalAudio({ ...validInput, durationSeconds: 10000000 }).error,
  'This recording is too long to save.'
)
assert.notEqual(
  validateOriginalAudio({ ...validInput, title: '   ' }).error,
  null
)
assert.notEqual(
  validateOriginalAudio({ ...validInput, title: '🎙'.repeat(121) }).error,
  null
)
assert.equal(
  validateOriginalAudio({ ...validInput, title: '🎙'.repeat(120) }).error,
  null
)

console.log('Audio upload validation tests passed.')
