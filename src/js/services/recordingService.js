const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
]

const ACTIVE_STATES = new Set(['requesting-permission', 'recording', 'processing'])

export function getRecordingSupport() {
  if (globalThis.isSecureContext === false) {
    return {
      supported: false,
      message: 'Microphone access requires localhost or a secure HTTPS connection.',
    }
  }

  if (typeof globalThis.navigator?.mediaDevices?.getUserMedia !== 'function') {
    return {
      supported: false,
      message: 'Microphone recording is not available in this browser. You can still choose an audio file.',
    }
  }

  if (typeof globalThis.MediaRecorder !== 'function') {
    return {
      supported: false,
      message: 'This browser cannot record microphone audio. You can still choose an audio file.',
    }
  }

  return { supported: true, message: '' }
}

function chooseMimeType(MediaRecorderConstructor) {
  if (typeof MediaRecorderConstructor.isTypeSupported !== 'function') {
    return ''
  }

  for (const mimeType of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorderConstructor.isTypeSupported(mimeType)) {
        return mimeType
      }
    } catch {
      return ''
    }
  }

  return ''
}

function createMediaRecorder(stream) {
  const MediaRecorderConstructor = globalThis.MediaRecorder
  const mimeType = chooseMimeType(MediaRecorderConstructor)

  if (mimeType) {
    try {
      return {
        recorder: new MediaRecorderConstructor(stream, { mimeType }),
        mimeType,
      }
    } catch {
      return {
        recorder: new MediaRecorderConstructor(stream),
        mimeType: '',
      }
    }
  }

  return {
    recorder: new MediaRecorderConstructor(stream),
    mimeType: '',
  }
}

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop())
}

function microphoneErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone permission was denied. Allow access in your browser settings, or choose an audio file instead.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect a microphone or choose an audio file instead.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone could not be started. It may be in use by another app. Close that app and try again, or choose an audio file.'
    case 'SecurityError':
      return 'Microphone access is blocked in this browser context. Open EchoVault on localhost or a secure HTTPS connection.'
    default:
      return 'The microphone could not be started. Check your browser permissions and try again, or choose an audio file.'
  }
}

export class RecordingService {
  constructor() {
    this.state = 'idle'
    this.errorMessage = ''
    this.blob = null
    this.mimeType = ''
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.requestedMimeType = ''
    this.operationId = 0
    this.disposed = false
    this.expectedTrackEnd = false
    this.trackHandlers = new Map()
    this.recorderHandlers = null
    this.listeners = new Set()
    this.stopPromise = null
    this.resolveStop = null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => this.listeners.delete(listener)
  }

  getSnapshot() {
    return {
      state: this.state,
      errorMessage: this.errorMessage,
      blob: this.blob,
      mimeType: this.mimeType,
    }
  }

  update(state, { errorMessage = '', blob = this.blob, mimeType = this.mimeType } = {}) {
    this.state = state
    this.errorMessage = errorMessage
    this.blob = blob
    this.mimeType = mimeType
    const snapshot = this.getSnapshot()

    this.listeners.forEach((listener) => listener(snapshot))
  }

  async start() {
    if (this.disposed || ACTIVE_STATES.has(this.state)) {
      return false
    }

    const support = getRecordingSupport()
    if (!support.supported) {
      this.update('error', { errorMessage: support.message, blob: null, mimeType: '' })
      return false
    }

    const operationId = ++this.operationId
    this.expectedTrackEnd = false
    this.chunks = []
    this.requestedMimeType = ''
    this.stopPromise = null
    this.resolveStop = null
    this.releaseStream()
    this.cleanupRecorder()
    this.update('requesting-permission', { errorMessage: '', blob: null, mimeType: '' })

    let stream
    try {
      stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      if (this.disposed) {
        return false
      }

      if (operationId !== this.operationId) {
        this.returnToIdleAfterCancelledPermission()
        return false
      }

      this.fail(microphoneErrorMessage(error), operationId)
      return false
    }

    if (this.disposed || operationId !== this.operationId) {
      stopTracks(stream)
      this.returnToIdleAfterCancelledPermission()
      return false
    }

    this.stream = stream
    try {
      this.attachTrackHandlers(stream, operationId)
      const { recorder, mimeType } = createMediaRecorder(stream)
      this.recorder = recorder
      this.attachRecorderHandlers(recorder, operationId)
      recorder.start()
      this.requestedMimeType = recorder.mimeType || mimeType
      this.update('recording', { errorMessage: '', blob: null, mimeType: this.requestedMimeType })
      return true
    } catch {
      this.fail(
        'Recording could not be initialized in this browser. Try again or choose an audio file instead.',
        operationId
      )
      return false
    }
  }

  stop() {
    if (this.state === 'processing' && this.stopPromise) {
      return this.stopPromise
    }

    if (this.state !== 'recording' || !this.recorder) {
      return Promise.resolve(null)
    }

    const operationId = this.operationId
    const recorder = this.recorder
    this.expectedTrackEnd = true
    const stopPromise = new Promise((resolve) => {
      this.resolveStop = resolve
    })
    this.stopPromise = stopPromise
    this.update('processing', { errorMessage: '' })

    try {
      if (recorder.state !== 'recording') {
        this.fail('Recording ended unexpectedly. Please try again.', operationId)
      } else {
        recorder.stop()
        this.releaseStream()
      }
    } catch {
      this.fail('The recording could not be stopped safely. Please try again.', operationId)
    }

    return stopPromise
  }

  attachTrackHandlers(stream, operationId) {
    stream.getTracks().forEach((track) => {
      const onEnded = () => {
        if (
          !this.expectedTrackEnd &&
          this.state === 'recording' &&
          operationId === this.operationId
        ) {
          this.fail(
            'The microphone disconnected before recording finished. Your recording was stopped.',
            operationId
          )
        }
      }

      track.addEventListener('ended', onEnded)
      this.trackHandlers.set(track, onEnded)
    })
  }

  attachRecorderHandlers(recorder, operationId) {
    const onDataAvailable = (event) => {
      if (operationId === this.operationId && event.data?.size > 0) {
        this.chunks.push(event.data)
      }
    }
    const onError = () => {
      this.fail(
        'Recording was interrupted. Try again or choose an audio file instead.',
        operationId
      )
    }
    const onStop = () => this.finishRecording(recorder, operationId)

    this.recorderHandlers = {
      onDataAvailable,
      onError,
      onStop,
    }
    recorder.addEventListener('dataavailable', onDataAvailable)
    recorder.addEventListener('error', onError)
    recorder.addEventListener('stop', onStop)
  }

  finishRecording(recorder, operationId) {
    if (this.disposed || operationId !== this.operationId || this.state === 'error') {
      return
    }

    if (this.state !== 'processing') {
      this.fail('Recording ended unexpectedly. Please try again.', operationId)
      return
    }

    const chunkMimeType = this.chunks.find((chunk) => chunk.type)?.type ?? ''
    const actualMimeType = recorder.mimeType || chunkMimeType || this.requestedMimeType
    const blob = actualMimeType
      ? new Blob(this.chunks, { type: actualMimeType })
      : new Blob(this.chunks)

    if (blob.size === 0) {
      this.fail('No audio was captured. Check your microphone and try again.', operationId)
      return
    }

    this.releaseStream()
    this.cleanupRecorder()
    this.chunks = []
    this.requestedMimeType = ''
    this.update('ready', { errorMessage: '', blob, mimeType: blob.type })
    this.resolveStop?.(blob)
    this.resolveStop = null
    this.stopPromise = null
  }

  fail(message, operationId) {
    if (operationId !== this.operationId || this.disposed) {
      return
    }

    this.expectedTrackEnd = true
    const recorder = this.recorder
    this.update('error', { errorMessage: message, blob: null, mimeType: '' })
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // The stream and listeners are still released if the recorder has already stopped.
      }
    }

    this.releaseStream()
    this.cleanupRecorder()
    this.chunks = []
    this.requestedMimeType = ''
    this.resolveStop?.(null)
    this.resolveStop = null
    this.stopPromise = null
  }

  releaseStream() {
    this.trackHandlers.forEach((handler, track) => {
      track.removeEventListener('ended', handler)
      track.stop()
    })
    this.trackHandlers.clear()
    this.stream = null
  }

  cleanupRecorder() {
    if (!this.recorder || !this.recorderHandlers) {
      this.recorder = null
      this.recorderHandlers = null
      return
    }

    this.recorder.removeEventListener('dataavailable', this.recorderHandlers.onDataAvailable)
    this.recorder.removeEventListener('error', this.recorderHandlers.onError)
    this.recorder.removeEventListener('stop', this.recorderHandlers.onStop)
    this.recorder = null
    this.recorderHandlers = null
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.cancel()
    this.disposed = true
    this.listeners.clear()
  }

  cancel() {
    if (this.disposed) {
      return
    }

    const permissionWasPending = this.state === 'requesting-permission'
    this.operationId += 1
    this.expectedTrackEnd = true
    const recorder = this.recorder
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Continue cleanup if the recorder has already stopped.
      }
    }

    this.releaseStream()
    this.cleanupRecorder()
    this.chunks = []
    this.requestedMimeType = ''
    this.resolveStop?.(null)
    this.resolveStop = null
    this.stopPromise = null
    if (!permissionWasPending) {
      this.update('idle', { errorMessage: '', blob: null, mimeType: '' })
    }
  }

  returnToIdleAfterCancelledPermission() {
    if (!this.disposed && this.state === 'requesting-permission') {
      this.update('idle', { errorMessage: '', blob: null, mimeType: '' })
    }
  }
}
