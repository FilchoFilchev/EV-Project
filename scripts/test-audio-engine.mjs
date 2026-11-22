import assert from 'node:assert/strict'
import {
  createAudioPreviewEngine,
  DEFAULT_MUFFLE_INTENSITY,
  getMuffleCutoffFrequency,
} from '../src/js/services/audioEngine.js'

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value
  }

  cancelScheduledValues() {}

  setTargetAtTime(value) {
    this.value = value
  }
}

class FakeAudioNode {
  constructor() {
    this.connections = []
  }

  connect(node) {
    this.connections.push(node)
  }

  disconnect() {
    this.connections = []
  }
}

class FakeAudioContext {
  static latest

  constructor() {
    this.state = 'suspended'
    this.currentTime = 0
    this.destination = new FakeAudioNode()
    FakeAudioContext.latest = this
  }

  async resume() {
    this.state = 'running'
  }

  async close() {
    this.state = 'closed'
  }

  createMediaElementSource(element) {
    this.mediaElement = element
    this.mediaSource = new FakeAudioNode()
    return this.mediaSource
  }

  createBiquadFilter() {
    this.filter = new FakeAudioNode()
    this.filter.type = 'lowpass'
    this.filter.frequency = new FakeAudioParam()
    this.filter.Q = new FakeAudioParam()
    return this.filter
  }

  createGain() {
    const gainNode = new FakeAudioNode()
    gainNode.gain = new FakeAudioParam()
    if (!this.dryGain) {
      this.dryGain = gainNode
    } else {
      this.wetGain = gainNode
    }
    return gainNode
  }
}

const previousAudioContext = globalThis.AudioContext
const previousWebkitAudioContext = globalThis.webkitAudioContext
globalThis.AudioContext = FakeAudioContext
delete globalThis.webkitAudioContext

try {
  assert.equal(getMuffleCutoffFrequency(0), 18000)
  assert.ok(Math.abs(getMuffleCutoffFrequency(100) - 350) < 0.001)
  assert.ok(getMuffleCutoffFrequency(80) < getMuffleCutoffFrequency(50))

  const audioElement = { play() {} }
  const engine = createAudioPreviewEngine(audioElement)

  assert.equal(engine.supported, true)
  assert.equal(engine.connected, false)
  await engine.apply('original')
  assert.equal(engine.connected, false)

  await engine.apply('muffle', DEFAULT_MUFFLE_INTENSITY)
  const context = FakeAudioContext.latest
  assert.equal(context.state, 'running')
  assert.equal(context.mediaElement, audioElement)
  assert.equal(context.filter.type, 'lowpass')
  assert.equal(context.filter.frequency.value, getMuffleCutoffFrequency(DEFAULT_MUFFLE_INTENSITY))
  assert.equal(context.dryGain.gain.value, 0)
  assert.equal(context.wetGain.gain.value, 1)
  assert.ok(context.mediaSource.connections.includes(context.dryGain))
  assert.ok(context.mediaSource.connections.includes(context.filter))

  const strongerMuffleFrequency = getMuffleCutoffFrequency(80)
  assert.ok(strongerMuffleFrequency < context.filter.frequency.value)
  engine.setIntensity(80)
  assert.equal(context.filter.frequency.value, strongerMuffleFrequency)

  await engine.apply('original', 80)
  assert.equal(engine.activeEffect, 'original')
  assert.equal(context.dryGain.gain.value, 1)
  assert.equal(context.wetGain.gain.value, 0)

  engine.reset()
  assert.equal(engine.activeEffect, 'original')
  assert.equal(engine.intensity, DEFAULT_MUFFLE_INTENSITY)
  assert.equal(context.dryGain.gain.value, 1)
  assert.equal(context.wetGain.gain.value, 0)

  assert.throws(() => getMuffleCutoffFrequency(-1), RangeError)
  assert.throws(() => getMuffleCutoffFrequency(101), RangeError)
  assert.throws(() => engine.setIntensity(101), RangeError)
  await assert.rejects(engine.apply('distortion'), TypeError)

  await engine.dispose()
  assert.equal(context.state, 'closed')
  assert.equal(engine.connected, false)

  globalThis.AudioContext = undefined
  const unsupportedEngine = createAudioPreviewEngine({ play() {} })
  assert.equal(unsupportedEngine.supported, false)
  await assert.rejects(unsupportedEngine.apply('muffle'), /not supported/)
  await unsupportedEngine.apply('original')
  assert.equal(unsupportedEngine.connected, false)
} finally {
  if (previousAudioContext === undefined) {
    delete globalThis.AudioContext
  } else {
    globalThis.AudioContext = previousAudioContext
  }
  if (previousWebkitAudioContext === undefined) {
    delete globalThis.webkitAudioContext
  } else {
    globalThis.webkitAudioContext = previousWebkitAudioContext
  }
}

console.log('Audio engine tests passed.')
