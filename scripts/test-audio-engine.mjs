import assert from 'node:assert/strict'
import {
  createAudioPreviewEngine,
  DEFAULT_MUFFLE_INTENSITY,
  createDistortionCurve,
  getEchoParameters,
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
  static instances = 0

  constructor() {
    FakeAudioContext.instances += 1
    this.state = 'suspended'
    this.currentTime = 0
    this.destination = new FakeAudioNode()
    this.gainNodes = []
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
    this.gainNodes.push(gainNode)
    return gainNode
  }

  createWaveShaper() {
    this.waveShaper = new FakeAudioNode()
    return this.waveShaper
  }

  createDelay(maxDelayTime) {
    this.delay = new FakeAudioNode()
    this.delay.maxDelayTime = maxDelayTime
    this.delay.delayTime = new FakeAudioParam()
    return this.delay
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

  const cleanCurve = createDistortionCurve(0)
  const drivenCurve = createDistortionCurve(100)
  assert.equal(cleanCurve.length, 2049)
  assert.ok(Math.abs(cleanCurve[512] + 0.5) < 0.001)
  assert.ok(Math.abs(drivenCurve[512]) <= 1)
  assert.ok(drivenCurve.every((sample) => sample >= -1 && sample <= 1))
  assert.ok(drivenCurve[1536] > cleanCurve[1536])

  for (let intensity = 0; intensity <= 100; intensity += 1) {
    const parameters = getEchoParameters(intensity)
    const maximumEchoPeak =
      parameters.dryGain + parameters.wetGain / (1 - parameters.feedbackGain)
    assert.ok(parameters.feedbackGain >= 0 && parameters.feedbackGain < 1)
    assert.ok(parameters.wetGain >= 0 && parameters.wetGain <= 0.25)
    assert.ok(maximumEchoPeak <= 1)
  }
  assert.deepEqual(getEchoParameters(0), {
    dryGain: 1,
    wetGain: 0,
    feedbackGain: 0,
  })

  const audioElement = { play() {} }
  const engine = createAudioPreviewEngine(audioElement)

  assert.equal(engine.supported, true)
  assert.equal(engine.connected, false)
  await engine.apply('original')
  assert.equal(engine.connected, false)

  await engine.apply('muffle', DEFAULT_MUFFLE_INTENSITY)
  const context = FakeAudioContext.latest
  const [
    dryGain,
    muffleOutputGain,
    distortionInputGain,
    distortionOutputGain,
    echoInputGain,
    feedbackGain,
    echoOutputGain,
  ] = context.gainNodes
  assert.equal(context.state, 'running')
  assert.equal(context.mediaElement, audioElement)
  assert.equal(context.filter.type, 'lowpass')
  assert.equal(context.filter.frequency.value, getMuffleCutoffFrequency(DEFAULT_MUFFLE_INTENSITY))
  assert.equal(dryGain.gain.value, 0)
  assert.equal(muffleOutputGain.gain.value, 1)
  assert.ok(context.mediaSource.connections.includes(dryGain))
  assert.ok(context.mediaSource.connections.includes(context.filter))

  const strongerMuffleFrequency = getMuffleCutoffFrequency(80)
  assert.ok(strongerMuffleFrequency < context.filter.frequency.value)
  assert.equal(engine.setIntensity(80), strongerMuffleFrequency)
  assert.equal(context.filter.frequency.value, strongerMuffleFrequency)

  await engine.apply('distortion', 80)
  assert.equal(engine.activeEffect, 'distortion')
  assert.equal(context.waveShaper.oversample, '4x')
  assert.equal(context.waveShaper.curve.length, 2049)
  assert.equal(distortionInputGain.gain.value, 1)
  assert.equal(distortionOutputGain.gain.value, 0.72)
  assert.equal(dryGain.gain.value, 0)
  assert.equal(muffleOutputGain.gain.value, 0)
  assert.equal(echoInputGain.gain.value, 0)
  assert.ok(context.mediaSource.connections.includes(distortionInputGain))
  assert.ok(context.waveShaper.connections.includes(distortionOutputGain))

  await engine.apply('distortion', 0)
  assert.equal(dryGain.gain.value, 1)
  assert.equal(distortionInputGain.gain.value, 0)
  assert.ok(Math.abs(context.waveShaper.curve[1536] - cleanCurve[1536]) < 0.001)

  await engine.apply('echo', 100)
  const strongestEcho = getEchoParameters(100)
  assert.equal(engine.activeEffect, 'echo')
  assert.ok(context.delay.delayTime.value > 0)
  assert.ok(context.delay.delayTime.value <= context.delay.maxDelayTime)
  assert.equal(dryGain.gain.value, strongestEcho.dryGain)
  assert.equal(echoInputGain.gain.value, 1)
  assert.equal(feedbackGain.gain.value, strongestEcho.feedbackGain)
  assert.equal(echoOutputGain.gain.value, strongestEcho.wetGain)
  assert.equal(distortionOutputGain.gain.value, 0)

  engine.setIntensity(40)
  const moderateEcho = getEchoParameters(40)
  assert.equal(feedbackGain.gain.value, moderateEcho.feedbackGain)
  assert.equal(echoOutputGain.gain.value, moderateEcho.wetGain)
  assert.equal(dryGain.gain.value, moderateEcho.dryGain)
  assert.equal(FakeAudioContext.instances, 1)

  await engine.apply('original', 80)
  assert.equal(engine.activeEffect, 'original')
  assert.equal(dryGain.gain.value, 1)
  assert.equal(muffleOutputGain.gain.value, 0)
  assert.equal(feedbackGain.gain.value, 0)
  assert.equal(echoOutputGain.gain.value, 0)

  engine.reset()
  assert.equal(engine.activeEffect, 'original')
  assert.equal(engine.intensity, DEFAULT_MUFFLE_INTENSITY)
  assert.equal(dryGain.gain.value, 1)
  assert.equal(muffleOutputGain.gain.value, 0)
  assert.equal(distortionInputGain.gain.value, 0)
  assert.equal(distortionOutputGain.gain.value, 0)
  assert.equal(echoInputGain.gain.value, 0)
  assert.equal(feedbackGain.gain.value, 0)
  assert.equal(echoOutputGain.gain.value, 0)

  assert.throws(() => getMuffleCutoffFrequency(-1), RangeError)
  assert.throws(() => getMuffleCutoffFrequency(101), RangeError)
  assert.throws(() => createDistortionCurve(101), RangeError)
  assert.throws(() => getEchoParameters(-1), RangeError)
  assert.throws(() => engine.setIntensity(101), RangeError)
  await assert.rejects(engine.apply('phaser'), TypeError)

  await engine.dispose()
  assert.equal(context.state, 'closed')
  assert.equal(engine.connected, false)
  assert.ok(context.gainNodes.every((node) => node.connections.length === 0))
  assert.equal(context.delay.connections.length, 0)

  globalThis.AudioContext = undefined
  const unsupportedEngine = createAudioPreviewEngine({ play() {} })
  assert.equal(unsupportedEngine.supported, false)
  await assert.rejects(unsupportedEngine.apply('muffle'), /not supported/)
  await assert.rejects(unsupportedEngine.apply('echo'), /not supported/)
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
