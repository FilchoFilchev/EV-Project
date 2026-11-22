import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import {
  createAudioPreviewEngine,
  DEFAULT_MUFFLE_INTENSITY,
} from '../services/audioEngine.js'
import { RecordingService, getRecordingSupport } from '../services/recordingService.js'
import {
  createOriginalRecording,
  findOwnedOriginalByPath,
} from '../services/voiceRecordingService.js'
import {
  removeUnreferencedAudio,
  uploadOriginalAudio,
} from '../services/storageService.js'
import { validateOriginalAudio } from '../utils/audioUploadValidation.js'
import { getPremiumEligibility } from '../services/subscriptionService.js'
import { saveEditedAudio } from '../services/editedVersionService.js'
import { requireAuthentication } from '../utils/routeGuard.js'
import { initPageTransitions } from '../utils/pageTransitions.js'

renderNavbar('studio')
renderFooter()
initPageTransitions()

const recordButton = document.querySelector('#record-button')
const stopButton = document.querySelector('#stop-button')
const playbackButton = document.querySelector('#playback-toggle')
const fileInput = document.querySelector('#audio-file')
const audioPlayer = document.querySelector('#studio-audio')
const effectInputs = [...document.querySelectorAll('input[name="studio-effect"]')]
const originalEffectInput = document.querySelector('#effect-original')
const effectIntensity = document.querySelector('#effect-intensity')
const effectIntensityLabel = document.querySelector('#effect-intensity-label')
const effectIntensityValue = document.querySelector('#effect-intensity-value')
const effectIntensityHelp = document.querySelector('#effect-intensity-help')
const effectPreviewButton = document.querySelector('#effect-preview-button')
const effectResetButton = document.querySelector('#effect-reset-button')
const effectError = document.querySelector('#effect-error')
const effectStatus = document.querySelector('#effect-status')
const premiumStatus = document.querySelector('#premium-status')
const premiumCheckButton = document.querySelector('#premium-check-button')
const saveEditedButton = document.querySelector('#save-edited-button')
const saveEditedStatus = document.querySelector('#save-edited-status')
const saveEditedError = document.querySelector('#save-edited-error')
const playbackSection = document.querySelector('#playback-section')
const playbackSource = document.querySelector('#playback-source')
const recordingStatus = document.querySelector('#recording-status')
const recordingTimer = document.querySelector('#recording-timer')
const recordingVisual = document.querySelector('#recording-visual')
const errorMessage = document.querySelector('#studio-error')
const fileImportHelp = document.querySelector('#audio-file-help')
const saveSection = document.querySelector('#save-original-section')
const saveForm = document.querySelector('#save-original-form')
const saveButton = document.querySelector('#save-original-button')
const saveError = document.querySelector('#save-original-error')
const saveStatus = document.querySelector('#save-original-status')
const titleInput = document.querySelector('#recording-title')
const categoryInput = document.querySelector('#recording-category')
const descriptionInput = document.querySelector('#recording-description')
const titleError = document.querySelector('#recording-title-error')
const categoryError = document.querySelector('#recording-category-error')
const recordingService = new RecordingService()
const recordingSupport = getRecordingSupport()
const audioPreviewEngine = createAudioPreviewEngine(audioPlayer)
const offlineExportSupported = typeof (globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext) === 'function'
const effectCopy = {
  original: {
    name: 'Original',
    intensityLabel: 'Effect intensity',
    intensityHelp: 'Choose Muffle, Distortion, or Echo to adjust its intensity.',
  },
  muffle: {
    name: 'Muffle',
    intensityLabel: 'Muffle intensity',
    intensityHelp: 'Higher intensity lowers the filter cutoff and softens more high frequencies.',
  },
  distortion: {
    name: 'Distortion',
    intensityLabel: 'Distortion intensity',
    intensityHelp: 'Higher intensity increases saturation. Output gain is limited to protect playback levels.',
  },
  echo: {
    name: 'Echo',
    intensityLabel: 'Echo intensity',
    intensityHelp: 'Higher intensity increases the echo mix and feedback within safe limits.',
  },
}

let recordingInterval = null
let recordingStartedAt = null
let elapsedRecordingMs = 0
let recordingInProgress = false
let playbackUrl = null
let playbackSourceKind = ''
let playbackAvailable = false
let currentAudioBlob = null
let currentAudioDuration = null
let savingOriginal = false
let originalSaved = false
let saveOutcomeUncertain = false
let appliedEffect = 'original'
let premiumAccess = false
let checkingPremium = false
let savingEdited = false
let editedOutcomeUncertain = false
let savedRecordingId = null

async function refreshPremiumAccess() {
  if (checkingPremium || savingEdited) return
  checkingPremium = true
  premiumCheckButton.disabled = true
  premiumStatus.textContent = 'Checking Premium access...'
  try {
    const result = await getPremiumEligibility()
    premiumAccess = !result.error && result.premium
    premiumStatus.textContent = result.error || (premiumAccess
      ? 'Premium is active. Preview effects and save separate edited WAV versions.'
      : 'Standard plan: original recording, playback, and saving are available. Effects and edited WAV saves require active Premium.')
    if (!premiumAccess) resetEffectControls('Original audio is selected. Effects require active Premium.')
  } finally {
    checkingPremium = false
    premiumCheckButton.disabled = false
    updateEffectControls()
  }
}

function showError(message) {
  errorMessage.textContent = message
  errorMessage.hidden = false
}

function handlePlaybackStarted() {
  updatePlaybackButton()
  if (!audioPreviewEngine.connected) {
    return
  }

  audioPreviewEngine.resume().catch(() => {
    audioPlayer.pause()
    showEffectError('Audio preview could not resume. Choose Preview to try again.')
  })
}

async function handleEffectPreview() {
  if (!playbackAvailable || !hasActivePlaybackSource()) {
    return
  }

  const effect = getSelectedEffect()
  if (savingEdited || (effect !== 'original' && !premiumAccess)) return
  const intensity = Number(effectIntensity.value)
  clearEffectError()

  try {
    await audioPreviewEngine.apply(effect, intensity)
    appliedEffect = effect
    audioPlayer.currentTime = 0
    await audioPlayer.play()
    effectStatus.textContent =
      effect === 'original'
        ? 'Playing the original audio. No effect is applied.'
        : `Playing a local ${effectCopy[effect].name} preview at ${intensity}% intensity. The original is unchanged.`
  } catch {
    showEffectError(
      'The preview could not start. Check browser audio permissions and try again. Your original audio is unchanged.'
    )
  } finally {
    updateEffectControls()
  }
}

function handleEffectReset() {
  audioPlayer.pause()
  if (hasActivePlaybackSource()) {
    audioPlayer.currentTime = 0
  }

  resetEffectControls('Original audio restored. Choose Preview Original to listen.')
}

function handleEffectSelectionChange() {
  clearEffectError()
  const selectedEffect = getSelectedEffect()
  const selectedEffectName = effectCopy[selectedEffect].name
  effectStatus.textContent = selectedEffect === 'original'
    ? appliedEffect !== 'original'
      ? 'Original is selected. Choose Preview Original or Reset to hear the unfiltered audio.'
      : 'Original audio is selected. Choose Preview Original to listen.'
    : `${selectedEffectName} is selected. Choose Preview ${selectedEffectName} to hear it; the original remains unchanged.`
  updateEffectControls()
}

function handleEffectIntensityInput() {
  const intensity = Number(effectIntensity.value)
  effectIntensityValue.value = `${intensity}%`
  effectIntensityValue.textContent = `${intensity}%`

  if (appliedEffect === getSelectedEffect() && appliedEffect !== 'original') {
    try {
      audioPreviewEngine.setIntensity(intensity)
    } catch {
      showEffectError(`${effectCopy[appliedEffect].name} intensity could not be updated. Reset the preview and try again.`)
    }
  }
}

function handleEffectIntensityChange() {
  if (appliedEffect === getSelectedEffect() && appliedEffect !== 'original') {
    effectStatus.textContent =
      `${effectCopy[appliedEffect].name} preview set to ${Number(effectIntensity.value)}% intensity.`
  }
}

function clearError() {
  const persistentMessage = recordingSupport.supported ? '' : recordingSupport.message
  errorMessage.textContent = persistentMessage
  errorMessage.hidden = !persistentMessage
}

function showSaveError(message) {
  saveError.textContent = message
  saveError.hidden = false
}

function clearSaveError() {
  saveError.textContent = ''
  saveError.hidden = true
}

function setSaveStatus(message, success = false) {
  saveStatus.replaceChildren(document.createTextNode(message))
  saveStatus.classList.toggle('text-success', success)
  saveStatus.classList.toggle('text-secondary', !success)
}

function getSelectedEffect() {
  return effectInputs.find((input) => input.checked)?.value ?? 'original'
}

function showEffectError(message) {
  effectError.textContent = message
  effectError.hidden = false
}

function clearEffectError() {
  effectError.textContent = ''
  effectError.hidden = true
}

function updateEffectControls(state = recordingService.state) {
  const isBusy = ['requesting-permission', 'recording', 'processing'].includes(state)
  const unavailable = !playbackAvailable || isBusy || savingOriginal || savingEdited
  const selectedEffect = getSelectedEffect()
  const selectedEffectCopy = effectCopy[selectedEffect]

  effectInputs.forEach((input) => {
    input.disabled =
      unavailable || (input.value !== 'original' && (!audioPreviewEngine.supported || !premiumAccess))
  })
  effectIntensityLabel.textContent = selectedEffectCopy.intensityLabel
  effectIntensityHelp.textContent = selectedEffectCopy.intensityHelp
  effectIntensity.disabled =
    unavailable || selectedEffect === 'original' || !audioPreviewEngine.supported || !premiumAccess
  effectPreviewButton.disabled = unavailable || (selectedEffect !== 'original' && !premiumAccess)
  effectPreviewButton.textContent = `Preview ${selectedEffectCopy.name}`
  effectResetButton.disabled =
    unavailable ||
    (selectedEffect === 'original' &&
      appliedEffect === 'original' &&
      Number(effectIntensity.value) === DEFAULT_MUFFLE_INTENSITY)
  saveEditedButton.disabled = unavailable || !premiumAccess || !savedRecordingId ||
    selectedEffect === 'original' || editedOutcomeUncertain ||
    !offlineExportSupported
  premiumCheckButton.disabled = checkingPremium || savingEdited || savingOriginal
  if (!offlineExportSupported) {
    saveEditedStatus.textContent = 'WAV export is not supported by this browser. Use a current browser to save edited versions.'
  } else if (!savingEdited && !saveEditedStatus.textContent) {
    saveEditedStatus.textContent = 'Save Original first, then choose an effect to save a separate private WAV.'
  }
}

function resetEffectControls(message = 'Original audio is selected. Choose Preview Original to listen.') {
  audioPreviewEngine.reset()
  appliedEffect = 'original'
  originalEffectInput.checked = true
  effectIntensity.value = String(DEFAULT_MUFFLE_INTENSITY)
  effectIntensityValue.value = `${DEFAULT_MUFFLE_INTENSITY}%`
  effectIntensityValue.textContent = `${DEFAULT_MUFFLE_INTENSITY}%`
  clearEffectError()
  effectStatus.textContent = audioPreviewEngine.supported
    ? message
    : 'Web Audio is unavailable in this browser. Original playback is still available.'
  updateEffectControls()
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

function resetSaveForm() {
  titleInput.value = ''
  categoryInput.value = ''
  descriptionInput.value = ''
  clearFieldError(titleInput, titleError)
  clearFieldError(categoryInput, categoryError)
  clearSaveError()
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
  currentAudioBlob = null
  currentAudioDuration = null
  originalSaved = false
  savedRecordingId = null
  editedOutcomeUncertain = false
  saveEditedStatus.textContent = ''
  saveEditedError.textContent = ''
  saveEditedError.hidden = true
  saveOutcomeUncertain = false
  resetEffectControls('Record or choose an audio file to preview an effect.')
  playbackSection.hidden = true
  saveSection.hidden = true
  playbackButton.disabled = true
  playbackButton.textContent = 'Play'
  playbackButton.setAttribute('aria-pressed', 'false')
  playbackSource.textContent = ''
  setSaveStatus('')
  resetSaveForm()
}

function updateSaveAvailability() {
  const audioValidation = validateOriginalAudio({
    blob: currentAudioBlob,
    durationSeconds: currentAudioDuration,
    title: 'Recording',
    category: 'Audio',
  })

  saveButton.disabled =
    savingOriginal ||
    savingEdited ||
    originalSaved ||
    saveOutcomeUncertain ||
    !currentAudioBlob ||
    Boolean(audioValidation.error)

  if (savingOriginal || originalSaved || saveOutcomeUncertain) {
    return
  }

  if (!currentAudioBlob) {
    setSaveStatus('')
  } else if (audioValidation.error) {
    setSaveStatus(audioValidation.error)
  } else {
    setSaveStatus('Audio is ready. It remains local until you choose Save Original.')
  }
}

function setPlaybackSource(blob, sourceKind, description) {
  releasePlaybackSource()
  currentAudioBlob = blob
  playbackSourceKind = sourceKind
  playbackSource.textContent = description
  playbackUrl = URL.createObjectURL(blob)
  playbackSection.hidden = false
  saveSection.hidden = false
  audioPlayer.src = playbackUrl
  audioPlayer.load()
  setSaveStatus('Reading audio details before it can be saved.')
  updateSaveAvailability()
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
  currentAudioDuration =
    Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0
      ? audioPlayer.duration
      : null
  updateSaveAvailability()
  updateEffectControls()
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
  recordButton.disabled = !recordingSupport.supported || isBusy || savingOriginal || savingEdited
  stopButton.disabled = state !== 'recording'
  fileInput.disabled = isBusy || savingOriginal || savingEdited
  playbackButton.disabled = !playbackAvailable || isBusy || savingOriginal || savingEdited
  recordingVisual.classList.toggle('is-recording', state === 'recording')
  updateEffectControls(state)
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
  return isAudioMimeType || ((!file.type || isGenericMimeType) && hasKnownAudioExtension(file))
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
  fileImportHelp.textContent =
    'This file remains local until you choose Save Original. Saved audio must be 20 MiB or smaller and use a supported format.'
}

function clearFieldError(input, errorElement) {
  input.removeAttribute('aria-invalid')
  errorElement.textContent = ''
  errorElement.hidden = true
}

function setFieldError(input, errorElement, message) {
  input.setAttribute('aria-invalid', 'true')
  errorElement.textContent = message
  errorElement.hidden = false
}

function validateSaveForm() {
  clearSaveError()
  clearFieldError(titleInput, titleError)
  clearFieldError(categoryInput, categoryError)

  let firstInvalidField = null
  const title = titleInput.value.trim()
  const category = categoryInput.value.trim()

  if (!title || Array.from(title).length > 120) {
    setFieldError(titleInput, titleError, 'Enter a title between 1 and 120 characters.')
    firstInvalidField = titleInput
  }

  if (!category || Array.from(category).length > 80) {
    setFieldError(categoryInput, categoryError, 'Enter a category between 1 and 80 characters.')
    firstInvalidField ??= categoryInput
  }

  if (firstInvalidField) {
    firstInvalidField.focus()
    return null
  }

  const validated = validateOriginalAudio({
    blob: currentAudioBlob,
    durationSeconds: currentAudioDuration,
    title,
    category,
    description: descriptionInput.value,
  })

  if (validated.error) {
    showSaveError(validated.error)
    return null
  }

  return validated
}

function markOriginalSaved(recording) {
  originalSaved = true
  savedRecordingId = recording.id
  saveOutcomeUncertain = false
  clearSaveError()
  saveButton.disabled = true
  saveStatus.replaceChildren(
    document.createTextNode(`“${recording.title}” is saved in your private library. `)
  )
  const libraryLink = document.createElement('a')
  libraryLink.href = '/my-library.html'
  libraryLink.textContent = 'Open My Library'
  saveStatus.append(libraryLink)
  saveStatus.classList.add('text-success')
  saveStatus.classList.remove('text-secondary')
}

async function reconcileFailedSave(storagePath, originalMessage, allowCleanup = false) {
  const verification = await findOwnedOriginalByPath(storagePath)
  if (verification.recording) {
    markOriginalSaved(verification.recording)
    return
  }

  if (verification.error) {
    saveOutcomeUncertain = true
    saveButton.disabled = true
    showSaveError(
      `${originalMessage} The save result could not be checked, so the upload was not removed. Check My Library before retrying.`
    )
    setSaveStatus('Save status is uncertain. Do not retry until you have checked My Library.')
    return
  }

  if (!allowCleanup) {
    saveOutcomeUncertain = true
    saveButton.disabled = true
    showSaveError(
      `${originalMessage} The metadata request may still have completed, so the file was not removed. Check My Library before retrying.`
    )
    setSaveStatus('Save status is uncertain. Do not retry until you have checked My Library.')
    return
  }

  const cleanup = await removeUnreferencedAudio(storagePath)
  if (cleanup.removed) {
    showSaveError(`${originalMessage} The unreferenced upload was removed. You can try again.`)
    return
  }

  saveOutcomeUncertain = true
  saveButton.disabled = true
  showSaveError(
    `${originalMessage} Cleanup could not be confirmed, so the private file may remain. Check My Library before retrying.`
  )
  setSaveStatus('Save status is uncertain. Do not retry until you have checked My Library.')
}

async function handleSaveOriginal(event) {
  event.preventDefault()
  if (savingOriginal || savingEdited || originalSaved || saveOutcomeUncertain || !currentAudioBlob) {
    return
  }

  const validated = validateSaveForm()
  if (!validated) {
    return
  }

  savingOriginal = true
  updateControls(recordingService.state)
  saveButton.disabled = true
  saveStatus.classList.remove('text-success')
  saveStatus.classList.add('text-secondary')
  setSaveStatus('Uploading private audio and saving its details...')

  let uploadPath = null
  try {
    const upload = await uploadOriginalAudio(currentAudioBlob, validated.mimeType)
    uploadPath = upload.path

    if (upload.error) {
      if (upload.path && upload.error.outcomeUnknown) {
        await reconcileFailedSave(upload.path, upload.error.message, true)
      } else {
        showSaveError(upload.error.message)
      }
      return
    }

    const result = await createOriginalRecording({
      ...validated,
      blob: currentAudioBlob,
      storagePath: upload.path,
    })

    if (result.recording) {
      markOriginalSaved(result.recording)
      return
    }

    await reconcileFailedSave(
      upload.path,
      result.error?.message ?? 'The recording could not be saved.',
      !result.error?.outcomeUnknown
    )
  } catch {
    if (uploadPath) {
      await reconcileFailedSave(
        uploadPath,
        'The save result could not be confirmed.',
        false
      )
    } else {
      showSaveError('The recording could not be saved. Check your connection and try again.')
    }
  } finally {
    savingOriginal = false
    updateControls(recordingService.state)
    updateSaveAvailability()
  }
}

async function handleSaveEdited() {
  if (saveEditedButton.disabled || savingEdited || !savedRecordingId || !premiumAccess) return
  const sourceBlob = currentAudioBlob
  savingEdited = true
  audioPlayer.pause()
  saveEditedError.hidden = true
  saveEditedError.textContent = ''
  saveEditedStatus.classList.remove('text-success')
  updateControls(recordingService.state)
  updateSaveAvailability()

  try {
    const result = await saveEditedAudio({
      recordingId: savedRecordingId,
      sourceBlob,
      effectType: getSelectedEffect(),
      intensity: Number(effectIntensity.value),
      onProgress: (message) => { saveEditedStatus.textContent = message },
    })
    if (sourceBlob !== currentAudioBlob) return
    if (result.error) {
      editedOutcomeUncertain = Boolean(result.error.outcomeUnknown)
      saveEditedError.textContent = result.error.message
      saveEditedError.hidden = false
      saveEditedStatus.textContent = editedOutcomeUncertain ? 'Check My Library before attempting another edited save.' : 'Your original remains saved. Review the error and try again.'
      return
    }
    saveEditedStatus.replaceChildren(document.createTextNode('Edited WAV saved privately. '))
    const link = document.createElement('a')
    link.href = '/my-library.html#edited-versions'
    link.textContent = 'Open Edited versions'
    saveEditedStatus.append(link)
    saveEditedStatus.classList.add('text-success')
  } finally {
    savingEdited = false
    updateControls(recordingService.state)
    updateSaveAvailability()
    await refreshPremiumAccess()
  }
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

function handleSaveFieldInput(input, errorElement) {
  clearFieldError(input, errorElement)
}

function removePageListeners() {
  recordButton.removeEventListener('click', handleRecordingStart)
  stopButton.removeEventListener('click', handleRecordingStop)
  playbackButton.removeEventListener('click', handlePlaybackToggle)
  fileInput.removeEventListener('change', handleFileSelection)
  saveForm.removeEventListener('submit', handleSaveOriginal)
  titleInput.removeEventListener('input', handleTitleInput)
  categoryInput.removeEventListener('input', handleCategoryInput)
  audioPlayer.removeEventListener('canplay', setPlaybackReady)
  audioPlayer.removeEventListener('loadedmetadata', setPlaybackReady)
  audioPlayer.removeEventListener('play', handlePlaybackStarted)
  audioPlayer.removeEventListener('pause', updatePlaybackButton)
  audioPlayer.removeEventListener('ended', updatePlaybackButton)
  audioPlayer.removeEventListener('error', handlePlaybackError)
  effectInputs.forEach((input) => input.removeEventListener('change', handleEffectSelectionChange))
  effectIntensity.removeEventListener('input', handleEffectIntensityInput)
  effectIntensity.removeEventListener('change', handleEffectIntensityChange)
  effectPreviewButton.removeEventListener('click', handleEffectPreview)
  effectResetButton.removeEventListener('click', handleEffectReset)
  saveEditedButton.removeEventListener('click', handleSaveEdited)
  premiumCheckButton.removeEventListener('click', refreshPremiumAccess)
}

function handleTitleInput() {
  handleSaveFieldInput(titleInput, titleError)
}

function handleCategoryInput() {
  handleSaveFieldInput(categoryInput, categoryError)
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

  if (!event.persisted) {
    audioPreviewEngine.dispose().catch(() => {
      console.error('The Studio audio preview could not release its Web Audio resources.')
    })
  }
}

const unsubscribeRecording = recordingService.subscribe(handleRecordingState)

recordButton.addEventListener('click', handleRecordingStart)
stopButton.addEventListener('click', handleRecordingStop)
playbackButton.addEventListener('click', handlePlaybackToggle)
fileInput.addEventListener('change', handleFileSelection)
saveForm.addEventListener('submit', handleSaveOriginal)
titleInput.addEventListener('input', handleTitleInput)
categoryInput.addEventListener('input', handleCategoryInput)
audioPlayer.addEventListener('canplay', setPlaybackReady)
audioPlayer.addEventListener('loadedmetadata', setPlaybackReady)
audioPlayer.addEventListener('play', handlePlaybackStarted)
audioPlayer.addEventListener('pause', updatePlaybackButton)
audioPlayer.addEventListener('ended', updatePlaybackButton)
audioPlayer.addEventListener('error', handlePlaybackError)
effectInputs.forEach((input) => input.addEventListener('change', handleEffectSelectionChange))
effectIntensity.addEventListener('input', handleEffectIntensityInput)
effectIntensity.addEventListener('change', handleEffectIntensityChange)
effectPreviewButton.addEventListener('click', handleEffectPreview)
effectResetButton.addEventListener('click', handleEffectReset)
saveEditedButton.addEventListener('click', handleSaveEdited)
premiumCheckButton.addEventListener('click', refreshPremiumAccess)
window.addEventListener('pagehide', handlePageHide)

if (!recordingSupport.supported) {
  showError(recordingSupport.message)
}
if (!audioPreviewEngine.supported) {
  effectStatus.textContent =
    'Web Audio is unavailable in this browser. Original playback is still available.'
}

requireAuthentication().then((user) => {
  if (user) refreshPremiumAccess()
})
