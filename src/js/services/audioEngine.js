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

    const nextFilter = context.createBiquadFilter()
    const nextDryGain = context.createGain()
    const nextMuffleOutputGain = context.createGain()
    const nextDistortionInputGain = context.createGain()
    const nextDistortionOutputGain = context.createGain()
    const nextEchoInputGain = context.createGain()
    const nextFeedbackGain = context.createGain()
    const nextEchoOutputGain = context.createGain()
    const nextWaveShaper = context.createWaveShaper()
    const nextDelay = context.createDelay(1)
    nextFilter.type = 'lowpass'
    nextFilter.Q.value = Math.SQRT1_2
    nextFilter.frequency.value = getMuffleCutoffFrequency(intensity)
    nextDryGain.gain.value = 1
    nextMuffleOutputGain.gain.value = 0
    nextDistortionInputGain.gain.value = 0
    nextDistortionOutputGain.gain.value = 0
    nextEchoInputGain.gain.value = 0
    nextFeedbackGain.gain.value = 0
    nextEchoOutputGain.gain.value = 0
    nextWaveShaper.curve = createDistortionCurve(intensity)
    nextWaveShaper.oversample = '4x'
    nextDelay.delayTime.value = ECHO_DELAY_SECONDS

    nextDryGain.connect(context.destination)
    nextFilter.connect(nextMuffleOutputGain)
    nextMuffleOutputGain.connect(context.destination)
    nextDistortionInputGain.connect(nextWaveShaper)
    nextWaveShaper.connect(nextDistortionOutputGain)
    nextDistortionOutputGain.connect(context.destination)
    nextEchoInputGain.connect(nextDelay)
    nextDelay.connect(nextEchoOutputGain)
    nextEchoOutputGain.connect(context.destination)
    nextDelay.connect(nextFeedbackGain)
    nextFeedbackGain.connect(nextDelay)

    const nextMediaSource = context.createMediaElementSource(audioElement)
    nextMediaSource.connect(nextDryGain)
    nextMediaSource.connect(nextFilter)
    nextMediaSource.connect(nextDistortionInputGain)
    nextMediaSource.connect(nextEchoInputGain)

    filterNode = nextFilter
    dryGain = nextDryGain
    muffleOutputGain = nextMuffleOutputGain
    distortionInputGain = nextDistortionInputGain
    distortionOutputGain = nextDistortionOutputGain
    waveShaperNode = nextWaveShaper
    echoInputGain = nextEchoInputGain
    delayNode = nextDelay
    feedbackGain = nextFeedbackGain
    echoOutputGain = nextEchoOutputGain
    mediaSource = nextMediaSource
  }

  function configureEffect() {
    if (!context || context.state === 'closed' || !dryGain) {
      return
    }

    const echoParameters = getEchoParameters(intensity)
    const distortionActive = activeEffect === 'distortion' && intensity > 0
    const echoActive = activeEffect === 'echo' && intensity > 0
    const distortionBypassed = activeEffect === 'distortion' && intensity === 0

    if (filterNode) {
      setAudioParam(
        context,
        filterNode.frequency,
        getMuffleCutoffFrequency(intensity)
      )
    }
    if (waveShaperNode && activeEffect === 'distortion') {
      waveShaperNode.curve = createDistortionCurve(intensity)
    }

    setAudioParam(
      context,
      dryGain.gain,
      activeEffect === 'original' || distortionBypassed
        ? 1
        : activeEffect === 'echo'
          ? echoParameters.dryGain
          : 0
    )
    setAudioParam(
      context,
      muffleOutputGain.gain,
      activeEffect === 'muffle' ? 1 : 0
    )
    setAudioParam(
      context,
      distortionInputGain.gain,
      distortionActive ? 1 : 0
    )
    setAudioParam(
      context,
      distortionOutputGain.gain,
      distortionActive ? DISTORTION_OUTPUT_GAIN : 0
    )
    setAudioParam(context, echoInputGain.gain, echoActive ? 1 : 0)
    setAudioParam(
      context,
      feedbackGain.gain,
      echoActive ? echoParameters.feedbackGain : 0
    )
    setAudioParam(
      context,
      echoOutputGain.gain,
      echoActive ? echoParameters.wetGain : 0
    )
  }

  async function apply(effect, nextIntensity = intensity) {
    if (!['original', 'muffle', 'distortion', 'echo'].includes(effect)) {
      throw new TypeError('Choose Original, Muffle, Distortion, or Echo.')
    }

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
