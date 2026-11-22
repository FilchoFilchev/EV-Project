import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { downloadOriginalAudio } from '../services/storageService.js'
import { listMyOriginalRecordings } from '../services/voiceRecordingService.js'
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
const playbackSection = document.querySelector('#library-playback')
const playbackTitle = document.querySelector('#library-playback-title')
const audioPlayer = document.querySelector('#library-audio')
const actionStatus = document.querySelector('#library-action-status')

let activePlaybackUrl = null
let activePlaybackId = null
const downloadUrls = new Map()

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

function createRecordingCard(recording) {
  const column = document.createElement('div')
  column.className = 'col-12 col-md-6'

  const card = document.createElement('article')
  card.className = 'card library-recording-card'
  const body = document.createElement('div')
  body.className = 'card-body'

  const heading = document.createElement('h2')
  heading.className = 'h5 mb-2'
  heading.textContent = recording.title

  const category = document.createElement('p')
  category.className = 'small fw-semibold text-secondary mb-3'
  category.textContent = recording.category

  const details = document.createElement('dl')
  details.className = 'row small mb-3'
  const detailValues = [
    ['Saved', formatDate(recording.created_at)],
    [
      'Duration',
      recording.original
        ? formatDuration(Number(recording.original.duration_seconds))
        : 'Audio unavailable',
    ],
    [
      'File size',
      recording.original
        ? formatFileSize(Number(recording.original.file_size_bytes))
        : 'Audio unavailable',
    ],
  ]

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

  const hasAudioPath = Boolean(recording.original?.storage_path)
  const playButton = document.createElement('button')
  playButton.className = 'btn btn-outline-primary'
  playButton.type = 'button'
  playButton.textContent = 'Play'
  playButton.disabled = !hasAudioPath
  playButton.setAttribute('aria-label', `Play ${recording.title}`)
  playButton.addEventListener('click', () => handlePlay(recording, playButton))

  const downloadButton = document.createElement('button')
  downloadButton.className = 'btn btn-primary'
  downloadButton.type = 'button'
  downloadButton.textContent = 'Download'
  downloadButton.disabled = !hasAudioPath
  downloadButton.setAttribute('aria-label', `Download ${recording.title}`)
  downloadButton.addEventListener('click', () => handleDownload(recording, downloadButton))

  actions.append(playButton, downloadButton)
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

async function getAudioBlob(recording) {
  if (!recording.original?.storage_path) {
    return { blob: null, error: { message: 'This recording has no available original audio.' } }
  }

  return downloadOriginalAudio(recording.original.storage_path)
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
    button.disabled = !recording.original?.storage_path
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
    link.download = safeFileName(recording.title, recording.original.mime_type)
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    actionStatus.textContent = `Download started for ${recording.title}.`
  } catch {
    actionStatus.textContent = 'Private audio could not be downloaded. Check your connection and try again.'
  } finally {
    button.disabled = !recording.original?.storage_path
  }
}

async function loadLibrary() {
  const user = await requireAuthentication()
  if (!user) {
    libraryStatus.textContent = 'Sign in is required to view your library.'
    return
  }

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

function handlePageHide(event) {
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
