import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initListingPublisher } from '../components/listingPublisher.js'
import { downloadOriginalAudio } from '../services/storageService.js'
import { listMyEditedVersions, listMyOriginalRecordings } from '../services/voiceRecordingService.js'
import { normalizeAudioMimeType } from '../utils/audioUploadValidation.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAuthentication } from '../utils/routeGuard.js'

renderNavbar('my-library')
renderFooter()
initPageTransitions()

const libraryStatus = document.querySelector('#library-status')
const libraryError = document.querySelector('#library-error')
const libraryEmpty = document.querySelector('#library-empty')
const libraryList = document.querySelector('#library-list')
const editedLibraryStatus = document.querySelector('#edited-library-status')
const editedLibraryError = document.querySelector('#edited-library-error')
const editedLibraryEmpty = document.querySelector('#edited-library-empty')
const editedLibraryList = document.querySelector('#edited-library-list')
const playbackSection = document.querySelector('#library-playback')
const playbackTitle = document.querySelector('#library-playback-title')
const audioPlayer = document.querySelector('#library-audio')
const actionStatus = document.querySelector('#library-action-status')

let activePlaybackUrl = null
let activePlaybackId = null
const downloadUrls = new Map()
const effectNames = { muffle: 'Muffle', distortion: 'Distortion', echo: 'Echo' }
const listingPublisher = initListingPublisher()

if (window.location.hash === '#edited-versions') {
  document.querySelector('#edited-versions-tab').click()
}
if (window.location.hash === '#my-listings') {
  document.querySelector('#my-listings-tab').click()
}

function showLibraryError(message) {
  libraryError.textContent = message
  libraryError.hidden = false
}

function clearLibraryError() {
  libraryError.textContent = ''
  libraryError.hidden = true
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Duration unavailable'
  }

  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainder = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function formatFileSize(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return 'File size unavailable'
  }

  return `${(value / (1024 * 1024)).toFixed(2)} MiB`
}

function safeFileName(title, mimeType) {
  const audioType = normalizeAudioMimeType(mimeType)
  const baseName =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'echovault-recording'
  return `${baseName}.${audioType?.extension ?? 'audio'}`
}

function releasePlaybackSource() {
  audioPlayer.pause()
  audioPlayer.removeAttribute('src')
  audioPlayer.load()

  if (activePlaybackUrl) {
    URL.revokeObjectURL(activePlaybackUrl)
    activePlaybackUrl = null
  }

  activePlaybackId = null
  playbackTitle.textContent = ''
  playbackSection.hidden = true
}

function trackDownloadUrl(url) {
  const timeoutId = window.setTimeout(() => {
    URL.revokeObjectURL(url)
    downloadUrls.delete(url)
  }, 60_000)
  downloadUrls.set(url, timeoutId)
}

function createRecordingCard(recording, version = recording.original, edited = false) {
  const column = document.createElement('div')
  column.className = 'col-12 col-md-6'

  const card = document.createElement('article')
  card.className = 'card library-recording-card'
  const body = document.createElement('div')
  body.className = 'card-body'

  const heading = document.createElement('h2')
  heading.className = 'h5 mb-2'
  const effectName = effectNames[version?.effect_type] ?? 'Edited'
  const audioTitle = edited ? `${recording.title} — ${effectName}` : recording.title
  heading.textContent = audioTitle

  const category = document.createElement('p')
  category.className = 'small fw-semibold text-secondary mb-3'
  category.textContent = recording.category

  const details = document.createElement('dl')
  details.className = 'row small mb-3'
  const detailValues = [
    ['Saved', formatDate(edited ? version.created_at : recording.created_at)],
    [
      'Duration',
      version
        ? formatDuration(Number(version.duration_seconds))
        : 'Audio unavailable',
    ],
    [
      'File size',
      version
        ? formatFileSize(Number(version.file_size_bytes))
        : 'Audio unavailable',
    ],
  ]
  if (edited) {
    detailValues.unshift(['Effect', effectName])
    const intensity = version.effect_settings?.intensity
    if (Number.isFinite(intensity) && intensity >= 0 && intensity <= 100) {
      detailValues.push(['Intensity', `${intensity}%`])
    }
  }

  for (const [label, value] of detailValues) {
    const term = document.createElement('dt')
    term.className = 'col-5 text-secondary'
    term.textContent = label
    const description = document.createElement('dd')
    description.className = 'col-7 mb-1'
    description.textContent = value
    details.append(term, description)
  }

  body.append(heading, category, details)

  if (recording.description) {
    const description = document.createElement('p')
    description.className = 'library-recording-description small text-secondary mb-0'
    description.textContent = recording.description
    body.append(description)
  }

  const actions = document.createElement('div')
  actions.className = 'library-recording-actions d-flex flex-column flex-sm-row gap-2'

  const audio = { ...version, title: audioTitle }
  const hasAudioPath = Boolean(audio.storage_path)
  const playButton = document.createElement('button')
  playButton.className = 'btn btn-outline-primary'
  playButton.type = 'button'
  playButton.textContent = 'Play'
  playButton.disabled = !hasAudioPath
  playButton.setAttribute('aria-label', `Play ${audioTitle}`)
  playButton.addEventListener('click', () => handlePlay(audio, playButton))

  const downloadButton = document.createElement('button')
  downloadButton.className = 'btn btn-primary'
  downloadButton.type = 'button'
  downloadButton.textContent = 'Download'
  downloadButton.disabled = !hasAudioPath
  downloadButton.setAttribute('aria-label', `Download ${audioTitle}`)
  downloadButton.addEventListener('click', () => handleDownload(audio, downloadButton))

  const publishButton = document.createElement('button')
  publishButton.className = 'btn btn-outline-primary'
  publishButton.type = 'button'
  publishButton.textContent = 'Publish'
  const publishDuration = Number(version?.duration_seconds)
  publishButton.disabled = !hasAudioPath || !version?.id || !Number.isFinite(publishDuration) || publishDuration < 5
  publishButton.setAttribute('aria-label', `Publish ${audioTitle}`)
  publishButton.addEventListener('click', () => listingPublisher.open({
    versionId: version.id,
    title: audioTitle,
    durationSeconds: Number(version.duration_seconds),
  }))
  if (publishDuration < 5) {
    publishButton.title = 'Publishing requires at least 5 seconds of saved audio.'
    const publishHelp = document.createElement('p')
    publishHelp.className = 'small text-secondary mt-3 mb-0'
    publishHelp.textContent = 'Publishing requires at least 5 seconds of saved audio.'
    body.append(publishHelp)
  }

  actions.append(playButton, downloadButton, publishButton)
  body.append(actions)
  card.append(body)
  column.append(card)
  return column
}

function renderRecordings(recordings) {
  const fragment = document.createDocumentFragment()
  recordings.forEach((recording) => fragment.append(createRecordingCard(recording)))
  libraryList.replaceChildren(fragment)
}

function renderEditedVersions(versions) {
  const fragment = document.createDocumentFragment()
  versions.forEach((version) => {
    if (version.recording) {
      fragment.append(createRecordingCard(version.recording, version, true))
    }
  })
  editedLibraryList.replaceChildren(fragment)
}

async function getAudioBlob(recording) {
  if (!recording.storage_path) {
    return { blob: null, error: { message: 'This version has no available private audio.' } }
  }

  return downloadOriginalAudio(recording.storage_path)
}

async function handlePlay(recording, button) {
  if (activePlaybackId === recording.id) {
    if (audioPlayer.paused) {
      try {
        await audioPlayer.play()
        actionStatus.textContent = `Playing ${recording.title}.`
      } catch {
        actionStatus.textContent = `Audio for ${recording.title} is ready. Use the player controls to start playback.`
      }
    } else {
      audioPlayer.pause()
      actionStatus.textContent = `Paused ${recording.title}.`
    }
    return
  }

  button.disabled = true
  actionStatus.textContent = `Loading private audio for ${recording.title}...`

  try {
    const result = await getAudioBlob(recording)
    if (result.error || !result.blob) {
      actionStatus.textContent = result.error?.message ?? 'The audio could not be loaded.'
      return
    }

    releasePlaybackSource()
    activePlaybackId = recording.id
    activePlaybackUrl = URL.createObjectURL(result.blob)
    playbackTitle.textContent = recording.title
    playbackSection.hidden = false
    audioPlayer.src = activePlaybackUrl
    audioPlayer.load()

    try {
      await audioPlayer.play()
      actionStatus.textContent = `Playing ${recording.title}.`
    } catch {
      actionStatus.textContent = `Audio for ${recording.title} is ready. Use the player controls to start playback.`
    }
  } catch {
    actionStatus.textContent = 'Private audio could not be loaded. Check your connection and try again.'
  } finally {
    button.disabled = !recording.storage_path
  }
}

async function handleDownload(recording, button) {
  button.disabled = true
  actionStatus.textContent = `Preparing the private download for ${recording.title}...`

  try {
    const result = await getAudioBlob(recording)
    if (result.error || !result.blob) {
      actionStatus.textContent = result.error?.message ?? 'The audio could not be downloaded.'
      return
    }

    const url = URL.createObjectURL(result.blob)
    trackDownloadUrl(url)
    const link = document.createElement('a')
    link.href = url
    link.download = safeFileName(recording.title, recording.mime_type)
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    actionStatus.textContent = `Download started for ${recording.title}.`
  } catch {
    actionStatus.textContent = 'Private audio could not be downloaded. Check your connection and try again.'
  } finally {
    button.disabled = !recording.storage_path
  }
}

async function loadLibrary() {
  const user = await requireAuthentication()
  if (!user) {
    libraryStatus.textContent = 'Sign in is required to view your library.'
    editedLibraryStatus.textContent = 'Sign in is required to view your edited versions.'
    return
  }

  await Promise.all([loadOriginalRecordings(), loadEditedVersions(), listingPublisher.loadListings()])
}

async function loadOriginalRecordings() {
  const result = await listMyOriginalRecordings()
  if (result.error) {
    libraryStatus.textContent = ''
    showLibraryError(result.error.message)
    return
  }

  clearLibraryError()
  const recordings = result.recordings ?? []
  renderRecordings(recordings)
  libraryEmpty.hidden = recordings.length > 0
  libraryStatus.textContent =
    recordings.length > 0
      ? `${recordings.length} original recording${recordings.length === 1 ? '' : 's'} in your private library.`
      : ''
}

async function loadEditedVersions() {
  const result = await listMyEditedVersions()
  if (result.error) {
    editedLibraryStatus.textContent = ''
    editedLibraryError.textContent = result.error.message
    editedLibraryError.hidden = false
    return
  }

  editedLibraryError.textContent = ''
  editedLibraryError.hidden = true
  const versions = result.versions ?? []
  renderEditedVersions(versions)
  editedLibraryEmpty.hidden = versions.length > 0
  editedLibraryStatus.textContent = versions.length > 0
    ? `${versions.length} edited version${versions.length === 1 ? '' : 's'} in your private library.`
    : ''
}

function handlePageHide(event) {
  listingPublisher.dispose()
  releasePlaybackSource()
  downloadUrls.forEach((timeoutId, url) => {
    window.clearTimeout(timeoutId)
    URL.revokeObjectURL(url)
  })
  downloadUrls.clear()
  if (!event.persisted) {
    window.removeEventListener('pagehide', handlePageHide)
  }
}

window.addEventListener('pagehide', handlePageHide)
loadLibrary()
