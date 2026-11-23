import { MAX_AUDIO_FILE_SIZE_BYTES } from '../utils/audioUploadValidation.js'
import { PREVIEW_SAMPLE_RATE, validatePreviewSelection } from '../utils/listingValidation.js'

export const DEFAULT_MUFFLE_INTENSITY = 50

const MIN_MUFFLE_CUTOFF_HZ = 350
const MAX_MUFFLE_CUTOFF_HZ = 18000
const GAIN_RAMP_SECONDS = 0.015
const DISTORTION_CURVE_SIZE = 2049
const DISTORTION_OUTPUT_GAIN = 0.72
const ECHO_DELAY_SECONDS = 0.28
const MAX_ECHO_FEEDBACK = 0.35
const MAX_ECHO_MIX = 0.25
const ECHO_DRY_REDUCTION = 0.4

function validateIntensity(intensity) {
  const value = Number(intensity)
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError('Effect intensity must be an integer from 0 to 100.')
  }
  return value
}

export function getMuffleCutoffFrequency(intensity) {
  const normalizedIntensity = validateIntensity(intensity) / 100
  return (
    MAX_MUFFLE_CUTOFF_HZ *
    (MIN_MUFFLE_CUTOFF_HZ / MAX_MUFFLE_CUTOFF_HZ) ** normalizedIntensity
  )
}

export function createDistortionCurve(intensity) {
  const value = validateIntensity(intensity)
  const curve = new Float32Array(DISTORTION_CURVE_SIZE)
  const drive = 1 + (value / 100) * 19
  const normalization = Math.tanh(drive)

  for (let index = 0; index < curve.length; index += 1) {
    const sample = (index / (curve.length - 1)) * 2 - 1
    curve[index] =
      value === 0 ? sample : Math.tanh(drive * sample) / normalization
  }

  return curve
}

export function getEchoParameters(intensity) {
  const amount = validateIntensity(intensity) / 100
  const wetGain = MAX_ECHO_MIX * amount
  const feedbackGain = MAX_ECHO_FEEDBACK * amount

  return {
    dryGain: 1 - ECHO_DRY_REDUCTION * amount,
    wetGain,
    feedbackGain,
  }
}

function setAudioParam(context, audioParam, value) {
  const now = context.currentTime
  audioParam.cancelScheduledValues(now)
  audioParam.setTargetAtTime(value, now, GAIN_RAMP_SECONDS)
}

function validateEffect(effect) {
  if (!['original', 'muffle', 'distortion', 'echo'].includes(effect)) {
    throw new TypeError('Choose Original, Muffle, Distortion, or Echo.')
  }
}

// Live preview and offline export use the same nodes, parameters and signal levels.
function createEffectGraph(context, source, intensity) {
  const filterNode = context.createBiquadFilter()
  const dryGain = context.createGain()
  const muffleOutputGain = context.createGain()
  const distortionInputGain = context.createGain()
  const distortionOutputGain = context.createGain()
  const echoInputGain = context.createGain()
  const feedbackGain = context.createGain()
  const echoOutputGain = context.createGain()
  const waveShaperNode = context.createWaveShaper()
  const delayNode = context.createDelay(1)
  filterNode.type = 'lowpass'
  filterNode.Q.value = Math.SQRT1_2
  filterNode.frequency.value = getMuffleCutoffFrequency(intensity)
  dryGain.gain.value = 1
  muffleOutputGain.gain.value = 0
  distortionInputGain.gain.value = 0
  distortionOutputGain.gain.value = 0
  echoInputGain.gain.value = 0
  feedbackGain.gain.value = 0
  echoOutputGain.gain.value = 0
  waveShaperNode.curve = createDistortionCurve(intensity)
  waveShaperNode.oversample = '4x'
  delayNode.delayTime.value = ECHO_DELAY_SECONDS

  dryGain.connect(context.destination)
  filterNode.connect(muffleOutputGain)
  muffleOutputGain.connect(context.destination)
  distortionInputGain.connect(waveShaperNode)
  waveShaperNode.connect(distortionOutputGain)
  distortionOutputGain.connect(context.destination)
  echoInputGain.connect(delayNode)
  delayNode.connect(echoOutputGain)
  echoOutputGain.connect(context.destination)
  delayNode.connect(feedbackGain)
  feedbackGain.connect(delayNode)
  source.connect(dryGain)
  source.connect(filterNode)
  source.connect(distortionInputGain)
  source.connect(echoInputGain)

  return {
    filterNode, dryGain, muffleOutputGain, distortionInputGain,
    distortionOutputGain, waveShaperNode, echoInputGain, delayNode,
    feedbackGain, echoOutputGain,
  }
}

function configureEffectGraph(context, nodes, effect, intensity, smooth = true) {
  const echoParameters = getEchoParameters(intensity)
  const distortionActive = effect === 'distortion' && intensity > 0
  const echoActive = effect === 'echo' && intensity > 0
  const set = (param, value) => {
    if (smooth) setAudioParam(context, param, value)
    else param.value = value
  }

  set(nodes.filterNode.frequency, getMuffleCutoffFrequency(intensity))
  if (effect === 'distortion') {
    nodes.waveShaperNode.curve = createDistortionCurve(intensity)
  }
  set(nodes.dryGain.gain,
    effect === 'original' || (effect === 'distortion' && intensity === 0)
      ? 1 : effect === 'echo' ? echoParameters.dryGain : 0)
  set(nodes.muffleOutputGain.gain, effect === 'muffle' ? 1 : 0)
  set(nodes.distortionInputGain.gain, distortionActive ? 1 : 0)
  set(nodes.distortionOutputGain.gain, distortionActive ? DISTORTION_OUTPUT_GAIN : 0)
  set(nodes.echoInputGain.gain, echoActive ? 1 : 0)
  set(nodes.feedbackGain.gain, echoActive ? echoParameters.feedbackGain : 0)
  set(nodes.echoOutputGain.gain, echoActive ? echoParameters.wetGain : 0)
}

export function getAudioEffectSettings(effect, intensity) {
  validateEffect(effect)
  const value = validateIntensity(intensity)
  if (effect === 'original') return {}
  if (effect === 'muffle') {
    return { intensity: value, cutoffHz: getMuffleCutoffFrequency(value) }
  }
  if (effect === 'distortion') {
    return { intensity: value, outputGain: value === 0 ? 1 : DISTORTION_OUTPUT_GAIN }
  }
  return { intensity: value, delaySeconds: ECHO_DELAY_SECONDS, ...getEchoParameters(value) }
}

export function encodeAudioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels
  const frameCount = buffer.length
  if (!Number.isInteger(channels) || channels < 1 || channels > 2 ||
      !Number.isSafeInteger(frameCount) || frameCount < 1 ||
      !Number.isInteger(buffer.sampleRate) || buffer.sampleRate <= 0) {
    throw new TypeError('WAV export requires a valid mono or stereo audio buffer.')
  }
  const byteLength = 44 + frameCount * channels * 2
  if (byteLength > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new RangeError('The rendered WAV exceeds 20 MiB. Use a shorter audio recording.')
  }
  const data = new ArrayBuffer(byteLength)
  const view = new DataView(data)
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, byteLength - 8, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, byteLength - 44, true)
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index))
  let offset = 44
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = channelData[channel][frame]
      const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
      offset += 2
    }
  }
  return new Blob([data], { type: 'audio/wav' })
}

export async function renderAudioWav(sourceBlob, { effectType, intensity } = {}) {
  validateEffect(effectType)
  const normalizedIntensity = validateIntensity(intensity)
  if (!sourceBlob || typeof sourceBlob.arrayBuffer !== 'function' || sourceBlob.size <= 0) {
    throw new TypeError('Choose a non-empty audio recording before exporting.')
  }
  if (sourceBlob.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new RangeError('Audio files must be 20 MiB or smaller.')
  }
  const OfflineContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
  if (typeof OfflineContext !== 'function') {
    throw new Error('WAV export is not supported by this browser. Try a current desktop browser.')
  }
  const decoder = new OfflineContext(2, 1, 44100)
  let decoded
  try {
    decoded = await decoder.decodeAudioData(await sourceBlob.arrayBuffer())
  } catch {
    throw new Error('This audio could not be decoded for WAV export. Choose another supported audio file.')
  }
  if (![1, 2].includes(decoded.numberOfChannels)) {
    throw new Error('WAV export supports mono or stereo audio. Choose a mono or stereo source file.')
  }
  let tailSeconds = 0
  if (effectType === 'echo' && normalizedIntensity > 0) {
    const { wetGain, feedbackGain } = getEchoParameters(normalizedIntensity)
    // Include repeats until the residual signal falls below -80 dB.
    const repeats = feedbackGain > 0
      ? Math.max(1, Math.ceil(Math.log(0.0001 / wetGain) / Math.log(feedbackGain)) + 1)
      : 1
    tailSeconds = ECHO_DELAY_SECONDS * repeats
  }
  const channels = decoded.numberOfChannels
  const frameCount = Math.ceil((decoded.duration + tailSeconds) * decoded.sampleRate)
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0 ||
      44 + frameCount * channels * 2 > MAX_AUDIO_FILE_SIZE_BYTES) {
    throw new RangeError('The rendered WAV exceeds 20 MiB. Use a shorter audio recording.')
  }
  const context = new OfflineContext(channels, frameCount, decoded.sampleRate)
  const source = context.createBufferSource()
  source.buffer = decoded
  const nodes = createEffectGraph(context, source, normalizedIntensity)
  configureEffectGraph(context, nodes, effectType, normalizedIntensity, false)
  source.start(0)
  let rendered
  try {
    rendered = await context.startRendering()
  } finally {
    source.disconnect()
    Object.values(nodes).forEach((node) => node.disconnect())
  }
  return {
    blob: encodeAudioBufferToWav(rendered),
    durationSeconds: rendered.length / rendered.sampleRate,
    effectType,
    effectSettings: getAudioEffectSettings(effectType, normalizedIntensity),
  }
}

export async function renderPublicPreview(sourceBlob, { startSeconds = 0, durationSeconds = 5 } = {}) {
  const selectionError = validatePreviewSelection(startSeconds, durationSeconds)
  if (selectionError) throw new RangeError(selectionError)
  if (!sourceBlob || typeof sourceBlob.arrayBuffer !== 'function' || !Number.isSafeInteger(sourceBlob.size) || sourceBlob.size <= 0) {
    throw new TypeError('Choose a non-empty saved audio version before generating a preview.')
  }
  if (sourceBlob.size > MAX_AUDIO_FILE_SIZE_BYTES) throw new RangeError('Audio files must be 20 MiB or smaller.')
  const OfflineContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext
  if (typeof OfflineContext !== 'function') throw new Error('Preview generation is not supported by this browser.')
  // Offline contexts do not open the microphone or an audio device and have no close() API.
  const decoder = new OfflineContext(1, 1, PREVIEW_SAMPLE_RATE)
  let decoded
  try {
    decoded = await decoder.decodeAudioData(await sourceBlob.arrayBuffer())
  } catch {
    throw new Error('This saved audio could not be decoded. Choose another version or browser.')
  }
  if (![1, 2].includes(decoded.numberOfChannels) || !Number.isFinite(decoded.duration) ||
      startSeconds + durationSeconds > decoded.duration + 0.000001) {
    throw new RangeError('Choose a 5–8 second segment that fits entirely inside a mono or stereo recording.')
  }
  const frameCount = Math.round(durationSeconds * PREVIEW_SAMPLE_RATE)
  const context = new OfflineContext(1, frameCount, PREVIEW_SAMPLE_RATE)
  const source = context.createBufferSource()
  source.buffer = decoded
  source.connect(context.destination)
  try {
    source.start(0, startSeconds, durationSeconds)
    const rendered = await context.startRendering()
    if (rendered.numberOfChannels !== 1 || rendered.sampleRate !== PREVIEW_SAMPLE_RATE || rendered.length !== frameCount) {
      throw new Error('The browser returned an invalid preview. Try generating it again.')
    }
    return { blob: encodeAudioBufferToWav(rendered), startSeconds, durationSeconds: frameCount / PREVIEW_SAMPLE_RATE }
  } finally {
    source.disconnect()
  }
}

export function createAudioPreviewEngine(audioElement) {
  if (!audioElement || typeof audioElement.play !== 'function') {
    throw new TypeError('An audio element is required for effect preview.')
  }

  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  const supported = typeof AudioContextConstructor === 'function'
  let context = null
  let mediaSource = null
  let filterNode = null
  let dryGain = null
  let muffleOutputGain = null
  let distortionInputGain = null
  let distortionOutputGain = null
  let waveShaperNode = null
  let echoInputGain = null
  let delayNode = null
  let feedbackGain = null
  let echoOutputGain = null
  let activeEffect = 'original'
  let intensity = DEFAULT_MUFFLE_INTENSITY

  async function ensureGraph() {
    if (!supported) {
      throw new Error('Audio effect preview is not supported by this browser.')
    }

    if (!context) {
      context = new AudioContextConstructor()
    }

    if (context.state !== 'running') {
      if (context.state === 'closed') {
        throw new Error('The audio preview is no longer available. Reload Studio and try again.')
      }
      await context.resume()
    }

    if (context.state !== 'running') {
      throw new Error('Audio preview could not start. Try the Preview button again.')
    }

    if (mediaSource) {
      return
    }

    const nextMediaSource = context.createMediaElementSource(audioElement)
    const nodes = createEffectGraph(context, nextMediaSource, intensity)
    ;({ filterNode, dryGain, muffleOutputGain, distortionInputGain,
      distortionOutputGain, waveShaperNode, echoInputGain, delayNode,
      feedbackGain, echoOutputGain } = nodes)
    mediaSource = nextMediaSource
  }

  function configureEffect() {
    if (!context || context.state === 'closed' || !dryGain) {
      return
    }

    configureEffectGraph(context, {
      filterNode, dryGain, muffleOutputGain, distortionInputGain,
      distortionOutputGain, waveShaperNode, echoInputGain, delayNode,
      feedbackGain, echoOutputGain,
    }, activeEffect, intensity)
  }

  async function apply(effect, nextIntensity = intensity) {
    validateEffect(effect)

    intensity = validateIntensity(nextIntensity)

    if (effect !== 'original' || context) {
      await ensureGraph()
    }

    activeEffect = effect
    configureEffect()
  }

  function setIntensity(nextIntensity) {
    intensity = validateIntensity(nextIntensity)
    configureEffect()
    return getMuffleCutoffFrequency(intensity)
  }

  function reset() {
    intensity = DEFAULT_MUFFLE_INTENSITY
    activeEffect = 'original'
    configureEffect()
  }

  async function resume() {
    if (!context || context.state === 'running') {
      return
    }
    if (context.state === 'closed') {
      throw new Error('The audio preview is no longer available. Reload Studio and try again.')
    }

    await context.resume()
    if (context.state !== 'running') {
      throw new Error('Audio preview could not resume. Choose Preview to try again.')
    }
  }

  async function dispose() {
    const previousContext = context
    const nodes = [
      mediaSource,
      filterNode,
      dryGain,
      muffleOutputGain,
      distortionInputGain,
      distortionOutputGain,
      waveShaperNode,
      echoInputGain,
      delayNode,
      feedbackGain,
      echoOutputGain,
    ]
    nodes.forEach((node) => node?.disconnect())
    context = null
    mediaSource = null
    filterNode = null
    dryGain = null
    muffleOutputGain = null
    distortionInputGain = null
    distortionOutputGain = null
    waveShaperNode = null
    echoInputGain = null
    delayNode = null
    feedbackGain = null
    echoOutputGain = null
    activeEffect = 'original'
    intensity = DEFAULT_MUFFLE_INTENSITY

    if (previousContext && previousContext.state !== 'closed') {
      await previousContext.close()
    }
  }

  return Object.freeze({
    get supported() {
      return supported
    },
    get connected() {
      return Boolean(mediaSource)
    },
    get activeEffect() {
      return activeEffect
    },
    get intensity() {
      return intensity
    },
    apply,
    setIntensity,
    reset,
    resume,
    dispose,
  })
}
