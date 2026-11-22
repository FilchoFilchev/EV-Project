export const DEFAULT_MUFFLE_INTENSITY = 50

const MIN_MUFFLE_CUTOFF_HZ = 350
const MAX_MUFFLE_CUTOFF_HZ = 18000
const GAIN_RAMP_SECONDS = 0.015

function validateIntensity(intensity) {
  const value = Number(intensity)
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError('Muffle intensity must be an integer from 0 to 100.')
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
  let wetGain = null
  let activeEffect = 'original'
  let intensity = DEFAULT_MUFFLE_INTENSITY

  async function ensureGraph() {
    if (!supported) {
      throw new Error('Muffle preview is not supported by this browser.')
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
    const nextWetGain = context.createGain()
    nextFilter.type = 'lowpass'
    nextFilter.Q.value = Math.SQRT1_2
    nextFilter.frequency.value = getMuffleCutoffFrequency(intensity)
    nextDryGain.gain.value = 1
    nextWetGain.gain.value = 0

    nextDryGain.connect(context.destination)
    nextFilter.connect(nextWetGain)
    nextWetGain.connect(context.destination)

    const nextMediaSource = context.createMediaElementSource(audioElement)
    nextMediaSource.connect(nextDryGain)
    nextMediaSource.connect(nextFilter)

    filterNode = nextFilter
    dryGain = nextDryGain
    wetGain = nextWetGain
    mediaSource = nextMediaSource
  }

  async function apply(effect, nextIntensity = intensity) {
    if (effect !== 'original' && effect !== 'muffle') {
      throw new TypeError('Only Original and Muffle previews are available.')
    }

    intensity = validateIntensity(nextIntensity)

    if (effect === 'muffle' || context) {
      await ensureGraph()
    }

    activeEffect = effect
    if (!context) {
      return
    }

    if (filterNode) {
      setAudioParam(
        context,
        filterNode.frequency,
        getMuffleCutoffFrequency(intensity),
      )
    }
    setAudioParam(context, dryGain.gain, effect === 'original' ? 1 : 0)
    setAudioParam(context, wetGain.gain, effect === 'muffle' ? 1 : 0)
  }

  function setIntensity(nextIntensity) {
    intensity = validateIntensity(nextIntensity)
    const cutoffFrequency = getMuffleCutoffFrequency(intensity)

    if (context && filterNode && activeEffect === 'muffle') {
      setAudioParam(context, filterNode.frequency, cutoffFrequency)
    }

    return cutoffFrequency
  }

  function reset() {
    intensity = DEFAULT_MUFFLE_INTENSITY
    activeEffect = 'original'
    if (!context || context.state === 'closed' || !dryGain || !wetGain) {
      return
    }

    setAudioParam(context, dryGain.gain, 1)
    setAudioParam(context, wetGain.gain, 0)
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
    mediaSource?.disconnect()
    filterNode?.disconnect()
    dryGain?.disconnect()
    wetGain?.disconnect()
    context = null
    mediaSource = null
    filterNode = null
    dryGain = null
    wetGain = null

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
