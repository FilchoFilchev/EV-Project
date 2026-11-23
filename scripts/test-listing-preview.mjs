import assert from 'node:assert/strict'
import { renderPublicPreview } from '../src/js/services/audioEngine.js'
import { MAX_AUDIO_FILE_SIZE_BYTES } from '../src/js/utils/audioUploadValidation.js'

class OfflineContext {
  static instances = []
  static duration = 12
  static channels = 2
  static decodeError = false
  static renderError = false
  constructor(channels, length, sampleRate) {
    Object.assign(this, { channels, length, sampleRate, destination: {} })
    OfflineContext.instances.push(this)
  }
  async decodeAudioData(bytes) {
    assert.ok(bytes.byteLength > 0)
    if (OfflineContext.decodeError) throw new Error('bad codec')
    return { numberOfChannels: OfflineContext.channels, duration: OfflineContext.duration }
  }
  createBufferSource() {
    this.source = {
      connect: (destination) => { assert.equal(destination, this.destination); this.connected = true },
      disconnect: () => { this.connected = false },
      start: (...args) => { this.started = args },
    }
    return this.source
  }
  async startRendering() {
    assert.equal(this.connected, true)
    if (OfflineContext.renderError) throw new Error('render failed')
    const samples = new Float32Array(this.length)
    samples[0] = 0.25
    return { numberOfChannels: this.channels, length: this.length, sampleRate: this.sampleRate, getChannelData: () => samples }
  }
}
const previous = globalThis.OfflineAudioContext
const previousWebkit = globalThis.webkitOfflineAudioContext
globalThis.OfflineAudioContext = OfflineContext
delete globalThis.webkitOfflineAudioContext
try {
  const source = new Blob(['original private bytes'], { type: 'audio/webm' })
  const before = await source.arrayBuffer()
  for (const [startSeconds, durationSeconds] of [[0, 5], [4, 8], [1.2, 5.001]]) {
    const result = await renderPublicPreview(source, { startSeconds, durationSeconds })
    const context = OfflineContext.instances.at(-1)
    const view = new DataView(await result.blob.arrayBuffer())
    assert.equal(result.blob.size, 44 + durationSeconds * 32000)
    assert.equal(result.durationSeconds, durationSeconds)
    assert.equal(view.getUint16(22, true), 1)
    assert.equal(view.getUint32(24, true), 16000)
    assert.equal(view.getInt16(44, true), 8192)
    assert.deepEqual(context.started, [0, startSeconds, durationSeconds])
    assert.equal(context.connected, false)
    assert.equal(context.source.buffer.duration, 12)
  }
  assert.deepEqual(await source.arrayBuffer(), before)
  const beforeInvalid = OfflineContext.instances.length
  await assert.rejects(renderPublicPreview(source, { durationSeconds: 4 }), /5 and 8/)
  await assert.rejects(renderPublicPreview(source, { startSeconds: -1 }), /start time/)
  await assert.rejects(renderPublicPreview(new Blob([])), /non-empty/)
  await assert.rejects(renderPublicPreview({ size: MAX_AUDIO_FILE_SIZE_BYTES + 1, arrayBuffer() {} }), /20 MiB/)
  assert.equal(OfflineContext.instances.length, beforeInvalid)
  await assert.rejects(renderPublicPreview(source, { startSeconds: 8, durationSeconds: 5 }), /fits entirely/)
  OfflineContext.duration = 4.9
  await assert.rejects(renderPublicPreview(source), /fits entirely/)
  OfflineContext.duration = 12
  OfflineContext.channels = 3
  await assert.rejects(renderPublicPreview(source), /mono or stereo/)
  OfflineContext.channels = 1
  OfflineContext.decodeError = true
  await assert.rejects(renderPublicPreview(source), /could not be decoded/)
  OfflineContext.decodeError = false
  OfflineContext.renderError = true
  await assert.rejects(renderPublicPreview(source), /render failed/)
  assert.equal(OfflineContext.instances.at(-1).connected, false)
  globalThis.OfflineAudioContext = undefined
  await assert.rejects(renderPublicPreview(source), /not supported/)
} finally {
  if (previous === undefined) delete globalThis.OfflineAudioContext
  else globalThis.OfflineAudioContext = previous
  if (previousWebkit === undefined) delete globalThis.webkitOfflineAudioContext
  else globalThis.webkitOfflineAudioContext = previousWebkit
}
console.log('Listing preview tests passed (actual PCM WAV output, crop offsets/length, mono resampling context, source preservation, limits and failure cleanup).')
