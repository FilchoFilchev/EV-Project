import assert from 'node:assert/strict'
import {
  encodeAudioBufferToWav,
  getAudioEffectSettings,
  getMuffleCutoffFrequency,
  renderAudioWav,
} from '../src/js/services/audioEngine.js'
import { MAX_AUDIO_FILE_SIZE_BYTES } from '../src/js/utils/audioUploadValidation.js'

function audioBuffer(samples, sampleRate = 44100) {
  return {
    numberOfChannels: samples.length,
    length: samples[0].length,
    sampleRate,
    duration: samples[0].length / sampleRate,
    getChannelData(index) { return samples[index] },
  }
}

const left = new Float32Array([-1.5, -0.5, 0, 0.5, 1.5, NaN])
const right = new Float32Array([0.25, -0.25, 1, -1, Infinity, 0])
const wav = encodeAudioBufferToWav(audioBuffer([left, right], 48000))
const wavBytes = await wav.arrayBuffer()
const header = new DataView(wavBytes)
const text = (offset, length) => new TextDecoder().decode(wavBytes.slice(offset, offset + length))
assert.equal(wav.type, 'audio/wav')
assert.equal(wav.size, 44 + left.length * 4)
assert.equal(text(0, 4), 'RIFF')
assert.equal(text(8, 4), 'WAVE')
assert.equal(text(12, 4), 'fmt ')
assert.equal(text(36, 4), 'data')
assert.equal(header.getUint32(4, true), wav.size - 8)
assert.equal(header.getUint32(16, true), 16)
assert.equal(header.getUint16(20, true), 1)
assert.equal(header.getUint16(22, true), 2)
assert.equal(header.getUint32(24, true), 48000)
assert.equal(header.getUint32(28, true), 48000 * 4)
assert.equal(header.getUint16(32, true), 4)
assert.equal(header.getUint16(34, true), 16)
assert.equal(header.getUint32(40, true), wav.size - 44)
assert.deepEqual(Array.from({ length: left.length * 2 }, (_, index) =>
  header.getInt16(44 + index * 2, true)), [
  -32768, 8192, -16384, -8192, 0, 32767, 16384, -32768, 32767, 0, 0, 0,
])
assert.equal(left[0], -1.5)
assert.ok(Number.isNaN(left[5]))
const monoWav = encodeAudioBufferToWav(audioBuffer([new Float32Array([0.5])]))
assert.equal(new DataView(await monoWav.arrayBuffer()).getUint16(22, true), 1)
assert.throws(() => encodeAudioBufferToWav(audioBuffer([left, right, left])), /mono or stereo/)
assert.throws(() => encodeAudioBufferToWav({ numberOfChannels: 2, length: 10000000, sampleRate: 44100 }), /20 MiB/)

class Node {
  constructor() {
    this.connections = []
    this.gain = { value: 0 }
    this.frequency = { value: 0 }
    this.Q = { value: 0 }
    this.delayTime = { value: 0 }
  }
  connect(node) { this.connections.push(node) }
  disconnect() { this.connections = [] }
}

class OfflineContext {
  static instances = []
  static decoded = audioBuffer([new Float32Array([0.9, -0.9])])
  static decodeError = false
  static renderError = false
  constructor(channels, length, sampleRate) {
    this.channels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.destination = new Node()
    this.gains = []
    OfflineContext.instances.push(this)
  }
  async decodeAudioData(bytes) {
    assert.ok(bytes instanceof ArrayBuffer)
    if (OfflineContext.decodeError) throw new Error('decode failed')
    return OfflineContext.decoded
  }
  createBufferSource() {
    this.source = new Node()
    this.source.start = (when) => { this.startedAt = when }
    return this.source
  }
  createBiquadFilter() { this.filter = new Node(); return this.filter }
  createGain() { const gain = new Node(); this.gains.push(gain); return gain }
  createWaveShaper() { this.shaper = new Node(); return this.shaper }
  createDelay() { this.delay = new Node(); return this.delay }
  async startRendering() {
    assert.equal(this.startedAt, 0)
    assert.equal(this.source.buffer, OfflineContext.decoded)
    assert.equal(this.source.connections.length, 4)
    assert.equal(this.delay.connections.length, 2)
    if (OfflineContext.renderError) throw new Error('render failed')
    // Return distinctive PCM data: the export must encode the rendered buffer.
    return audioBuffer(Array.from({ length: this.channels }, () => {
      const samples = new Float32Array(this.length)
      samples[0] = 0.25
      return samples
    }), this.sampleRate)
  }
}

const previousOffline = globalThis.OfflineAudioContext
const previousWebkitOffline = globalThis.webkitOfflineAudioContext
globalThis.OfflineAudioContext = OfflineContext
delete globalThis.webkitOfflineAudioContext
try {
  const sourceBlob = new Blob(['unchanged source'], { type: 'audio/webm' })
  const beforeBytes = await sourceBlob.arrayBuffer()
  for (const effectType of ['muffle', 'distortion', 'echo']) {
    const result = await renderAudioWav(sourceBlob, { effectType, intensity: 80 })
    const context = OfflineContext.instances.at(-1)
    assert.equal(result.effectType, effectType)
    assert.deepEqual(result.effectSettings, getAudioEffectSettings(effectType, 80))
    assert.equal(result.durationSeconds, context.length / context.sampleRate)
    assert.equal(result.blob.type, 'audio/wav')
    assert.equal(new DataView(await result.blob.arrayBuffer()).getInt16(44, true), 8192)
    assert.ok(context.source.connections.length === 0)
    assert.ok(context.gains.every((gain) => gain.connections.length === 0))
    const [dry, muffle, distortionIn, distortionOut, echoIn, feedback, echoOut] = context.gains
    if (effectType === 'muffle') {
      assert.equal(context.filter.type, 'lowpass')
      assert.equal(context.filter.frequency.value, getMuffleCutoffFrequency(80))
      assert.equal(muffle.gain.value, 1)
      assert.equal(dry.gain.value, 0)
      assert.equal(context.length, OfflineContext.decoded.length)
    } else if (effectType === 'distortion') {
      assert.equal(context.shaper.oversample, '4x')
      assert.equal(context.shaper.curve.length, 2049)
      assert.equal(distortionIn.gain.value, 1)
      assert.equal(distortionOut.gain.value, 0.72)
    } else {
      assert.equal(context.delay.delayTime.value, 0.28)
      assert.equal(echoIn.gain.value, 1)
      assert.equal(feedback.gain.value, 0.35 * 0.8)
      assert.equal(echoOut.gain.value, 0.25 * 0.8)
      assert.ok(context.length > OfflineContext.decoded.length + 0.28 * 44100)
      assert.ok(context.length < OfflineContext.decoded.length + 3 * 44100)
    }
  }
  assert.deepEqual(await sourceBlob.arrayBuffer(), beforeBytes)
  assert.deepEqual(Array.from(OfflineContext.decoded.getChannelData(0)), Array.from(new Float32Array([0.9, -0.9])))
  await renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 0 })
  assert.equal(OfflineContext.instances.at(-1).length, OfflineContext.decoded.length)
  await renderAudioWav(sourceBlob, { effectType: 'distortion', intensity: 0 })
  assert.equal(OfflineContext.instances.at(-1).gains[0].gain.value, 1)

  OfflineContext.decoded = audioBuffer([left, right])
  const stereo = await renderAudioWav(sourceBlob, { effectType: 'muffle', intensity: 50 })
  assert.equal(new DataView(await stereo.blob.arrayBuffer()).getUint16(22, true), 2)

  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'phaser', intensity: 50 }), /Choose Original/)
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 101 }), RangeError)
  await assert.rejects(renderAudioWav(new Blob([]), { effectType: 'echo', intensity: 50 }), /non-empty/)
  await assert.rejects(renderAudioWav({ size: MAX_AUDIO_FILE_SIZE_BYTES + 1, arrayBuffer() {} },
    { effectType: 'echo', intensity: 50 }), /20 MiB/)
  OfflineContext.decoded = audioBuffer([left, left, left])
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 50 }), /mono or stereo/)
  OfflineContext.decoded = { numberOfChannels: 2, sampleRate: 44100, duration: 3600 }
  const instancesBeforeOversizedRender = OfflineContext.instances.length
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 50 }), /20 MiB/)
  assert.equal(OfflineContext.instances.length, instancesBeforeOversizedRender + 1)

  OfflineContext.decodeError = true
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 50 }), /could not be decoded/)
  OfflineContext.decodeError = false
  OfflineContext.decoded = audioBuffer([left])
  OfflineContext.renderError = true
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 50 }), /render failed/)
  assert.equal(OfflineContext.instances.at(-1).source.connections.length, 0)
  OfflineContext.renderError = false

  globalThis.OfflineAudioContext = undefined
  await assert.rejects(renderAudioWav(sourceBlob, { effectType: 'echo', intensity: 50 }), /not supported/)
} finally {
  if (previousOffline === undefined) delete globalThis.OfflineAudioContext
  else globalThis.OfflineAudioContext = previousOffline
  if (previousWebkitOffline === undefined) delete globalThis.webkitOfflineAudioContext
  else globalThis.webkitOfflineAudioContext = previousWebkitOffline
}

console.log('Audio export tests passed (PCM WAV encoding, offline graph wiring, echo tails, immutable source and limits).')
