import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { RecordingService, getRecordingSupport } from '../services/recordingService.js'
import { requireAuthentication } from '../utils/routeGuard.js'
import { initPageTransitions } from '../utils/pageTransitions.js'

renderNavbar('studio')
renderFooter()
initPageTransitions()
requireAuthentication()

const recordButton = document.querySelector('#record-button')
const stopButton = document.querySelector('#stop-button')
const playbackButton = document.querySelector('#playback-toggle')
const fileInput = document.querySelector('#audio-file')
const audioPlayer = document.querySelector('#studio-audio')
const playbackSection = document.querySelector('#playback-section')
const playbackSource = document.querySelector('#playback-source')
const recordingStatus = document.querySelector('#recording-status')
const recordingTimer = document.querySelector('#recording-timer')
const recordingVisual = document.querySelector('#recording-visual')
const errorMessage = document.querySelector('#studio-error')
const fileImportHelp = document.querySelector('#audio-file-help')
const recordingService = new RecordingService()
const recordingSupport = getRecordingSupport()

let recordingInterval = null
let recordingStartedAt = null
let elapsedRecordingMs = 0
let recordingInProgress = false
let playbackUrl = null
let playbackSourceKind = ''
let playbackAvailable = false

function showError(message) {
  errorMessage.textContent = message
  errorMessage.hidden = false
}

function clearError() {
  const persistentMessage = recordingSupport.supported ? '' : recordingSupport.message
  errorMessage.textContent = persistentMessage
  errorMessage.hidden = !persistentMessage
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function updateTimer() {
  const elapsed =
    recordingStartedAt === null
      ? elapsedRecordingMs
      : elapsedRecordingMs + (performance.now() - recordingStartedAt)
  recordingTimer.textContent = formatTime(elapsed)
}

function stopTimer({ reset = false } = {}) {
  if (recordingInterval !== null) {
    window.clearInterval(recordingInterval)
    recordingInterval = null
  }

  if (recordingStartedAt !== null) {
    elapsedRecordingMs += performance.now() - recordingStartedAt
    recordingStartedAt = null
  }

  if (reset) {
    elapsedRecordingMs = 0
  }

  updateTimer()
}

function startTimer() {
  stopTimer({ reset: true })
  recordingStartedAt = performance.now()
  updateTimer()
  recordingInterval = window.setInterval(updateTimer, 250)
}

function releasePlaybackSource() {
  audioPlayer.pause()
  audioPlayer.removeAttribute('src')
  audioPlayer.load()

  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl)
    playbackUrl = null
  }

  playbackAvailable = false
  playbackSourceKind = ''
  playbackSection.hidden = true
  playbackButton.disabled = true
  playbackButton.textContent = 'Play'
  playbackButton.setAttribute('aria-pressed', 'false')
  playbackSource.textContent = ''
}

function setPlaybackSource(blob, sourceKind, description) {
  releasePlaybackSource()
  playbackSourceKind = sourceKind
  playbackSource.textContent = description
  playbackUrl = URL.createObjectURL(blob)
  playbackSection.hidden = false
  audioPlayer.src = playbackUrl
  audioPlayer.load()
}

function hasActivePlaybackSource() {
  return Boolean(
    playbackUrl && (audioPlayer.currentSrc === playbackUrl || audioPlayer.src === playbackUrl)
  )
}

function setPlaybackReady() {
  if (!hasActivePlaybackSource() || audioPlayer.readyState < 1) {
    return
  }

  playbackAvailable = true
  playbackButton.disabled = false
  clearError()
}

function handlePlaybackError() {
  if (!hasActivePlaybackSource()) {
    return
  }

  const sourceKind = playbackSourceKind
  releasePlaybackSource()
  showError(
    sourceKind === 'file'
      ? 'This audio file could not be played by your browser. Try a different supported audio format.'
      : 'The recording could not be played in this browser. You can try recording again or choose an audio file.'
  )
}

function updatePlaybackButton() {
  const isPlaying = !audioPlayer.paused && !audioPlayer.ended
  playbackButton.textContent = isPlaying ? 'Pause' : 'Play'
  playbackButton.setAttribute('aria-pressed', String(isPlaying))
}

function updateControls(state) {
  const isBusy = ['requesting-permission', 'recording', 'processing'].includes(state)
  recordButton.disabled = !recordingSupport.supported || isBusy
  stopButton.disabled = state !== 'recording'
  fileInput.disabled = isBusy
  playbackButton.disabled = !playbackAvailable || isBusy
  recordingVisual.classList.toggle('is-recording', state === 'recording')
}

function handleRecordingState(snapshot) {
  updateControls(snapshot.state)

  switch (snapshot.state) {
    case 'idle':
      recordingStatus.textContent =
        'Ready when you are. Microphone access starts only after you choose Record.'
      break
    case 'requesting-permission':
      recordingStatus.textContent = 'Waiting for microphone permission...'
      break
    case 'recording':
      clearError()
      recordingInProgress = true
      releasePlaybackSource()
      startTimer()
      recordingStatus.textContent = 'Recording. Choose Stop when you are finished.'
      break
    case 'processing':
      stopTimer()
      recordingStatus.textContent = 'Preparing your local recording...'
      break
    case 'ready':
      recordingInProgress = false
      if (snapshot.blob) {
        setPlaybackSource(
          snapshot.blob,
          'recording',
          `Recording ready${snapshot.mimeType ? ` (${snapshot.mimeType})` : ''}.`
        )
        recordingStatus.textContent = 'Recording ready for local playback.'
      }
      break
    case 'error':
      if (recordingInProgress) {
        stopTimer({ reset: true })
        releasePlaybackSource()
      }
      recordingInProgress = false
      recordingStatus.textContent = 'Recording is not active.'
      showError(snapshot.errorMessage)
      break
  }
}

function hasKnownAudioExtension(file) {
  return /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|weba|webm)$/i.test(file.name)
}

function isAudioFile(file) {
  if (!file || file.size === 0) {
    return false
  }

  const isAudioMimeType = file.type.toLowerCase().startsWith('audio/')
  const isGenericMimeType = file.type.toLowerCase() === 'application/octet-stream'
  return (
    isAudioMimeType ||
    ((!file.type || isGenericMimeType) && hasKnownAudioExtension(file))
  )
}

function handleFileSelection() {
  const file = fileInput.files?.[0]
  if (!file) {
    return
  }

  if (!isAudioFile(file)) {
    fileInput.value = ''
    showError('Choose a non-empty audio file. The selected file was not recognized as audio.')
    return
  }

  if (file.type.startsWith('audio/') && !audioPlayer.canPlayType(file.type)) {
    fileInput.value = ''
    showError('This browser does not support the selected audio format. Try another audio file.')
    return
  }

  clearError()
  stopTimer({ reset: true })
  setPlaybackSource(file, 'file', `Local file: ${file.name}`)
  recordingStatus.textContent = 'Audio file ready for local playback.'
  fileImportHelp.textContent = 'This file remains local to your browser and is not uploaded.'
}

async function handlePlaybackToggle() {
  if (!playbackAvailable) {
    return
  }

  if (audioPlayer.paused) {
    try {
      await audioPlayer.play()
    } catch {
      showError('Playback could not start. Use the audio player controls or choose another file.')
    }
  } else {
    audioPlayer.pause()
  }
}

function handleRecordingStart() {
  clearError()
  recordingService.start()
}

function handleRecordingStop() {
  recordingService.stop()
}

function removePageListeners() {
  recordButton.removeEventListener('click', handleRecordingStart)
  stopButton.removeEventListener('click', handleRecordingStop)
  playbackButton.removeEventListener('click', handlePlaybackToggle)
  fileInput.removeEventListener('change', handleFileSelection)
  audioPlayer.removeEventListener('canplay', setPlaybackReady)
  audioPlayer.removeEventListener('loadedmetadata', setPlaybackReady)
  audioPlayer.removeEventListener('play', updatePlaybackButton)
  audioPlayer.removeEventListener('pause', updatePlaybackButton)
  audioPlayer.removeEventListener('ended', updatePlaybackButton)
  audioPlayer.removeEventListener('error', handlePlaybackError)
}

function handlePageHide(event) {
  stopTimer({ reset: true })
  if (event.persisted) {
    recordingService.cancel()
  } else {
    recordingService.dispose()
    unsubscribeRecording()
    removePageListeners()
    window.removeEventListener('pagehide', handlePageHide)
  }

  releasePlaybackSource()
  fileInput.value = ''
}

const unsubscribeRecording = recordingService.subscribe(handleRecordingState)

recordButton.addEventListener('click', handleRecordingStart)
stopButton.addEventListener('click', handleRecordingStop)
playbackButton.addEventListener('click', handlePlaybackToggle)
fileInput.addEventListener('change', handleFileSelection)
audioPlayer.addEventListener('canplay', setPlaybackReady)
audioPlayer.addEventListener('loadedmetadata', setPlaybackReady)
audioPlayer.addEventListener('play', updatePlaybackButton)
audioPlayer.addEventListener('pause', updatePlaybackButton)
audioPlayer.addEventListener('ended', updatePlaybackButton)
audioPlayer.addEventListener('error', handlePlaybackError)
window.addEventListener('pagehide', handlePageHide)

if (!recordingSupport.supported) {
  showError(recordingSupport.message)
}
