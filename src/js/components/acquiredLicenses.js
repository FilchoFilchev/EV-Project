import { listMyLicenses } from '../services/licenseService.js'
import { getLicensedAudio } from '../services/licensedAudioService.js'
import { subscribeToAuthState } from '../services/authService.js'
import { formatEuroCents } from '../utils/marketplaceFilters.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Date unavailable'
}

export function initAcquiredLicenses() {
  const status = document.querySelector('#licenses-status')
  const error = document.querySelector('#licenses-error')
  const empty = document.querySelector('#licenses-empty')
  const list = document.querySelector('#licenses-list')
  const refresh = document.querySelector('#licenses-refresh')
  let loading = false
  let actionPending = false
  let generation = 0
  let disposed = false
  let accountId
  let playback = null
  const actions = []
  const downloadUrls = new Map()

  function releasePlayback() {
    if (!playback) return
    playback.player.pause()
    playback.player.removeAttribute('src')
    playback.player.load()
    playback.player.hidden = true
    playback.status.textContent = 'Playback stopped.'
    URL.revokeObjectURL(playback.url)
    playback = null
  }

  function reset() {
    generation++
    loading = false
    actionPending = false
    releasePlayback()
    for (const [url, timer] of downloadUrls) {
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
    }
    downloadUrls.clear()
    actions.length = 0
    list.replaceChildren()
    list.setAttribute('aria-busy', 'false')
    refresh.disabled = false
  }

  function setActionsDisabled(disabled) {
    for (const button of actions) button.disabled = disabled
  }

  async function accessAudio(licenseId, mode, player, actionStatus) {
    if (disposed || actionPending || loading) return
    actionPending = true
    const request = generation
    setActionsDisabled(true)
    // A new action never reuses a previously downloaded rental blob.
    releasePlayback()
    actionStatus.textContent = mode === 'play' ? 'Loading licensed full audio…' : 'Preparing licensed download…'
    try {
      const result = await getLicensedAudio(licenseId)
      if (disposed || request !== generation) return
      if (result.error || !result.audio) {
        actionStatus.textContent = result.error?.message || 'The licensed audio is unavailable. Please try again.'
        return
      }
      const { audio } = result
      const url = URL.createObjectURL(audio.blob)
      if (mode === 'play') {
        playback = { player, url, status: actionStatus }
        player.src = url
        player.hidden = false
        player.load()
        try {
          await player.play()
          if (request === generation && playback?.url === url) actionStatus.textContent = `Playing ${audio.title}.`
        } catch {
          if (request === generation && playback?.url === url) actionStatus.textContent = 'Full audio is ready. Use the player controls to start playback.'
        }
      } else {
        const timer = window.setTimeout(() => {
          URL.revokeObjectURL(url)
          downloadUrls.delete(url)
        }, 60_000)
        downloadUrls.set(url, timer)
        const link = element('a')
        link.href = url
        link.download = audio.filename
        link.hidden = true
        document.body.append(link)
        try { link.click() } finally { link.remove() }
        actionStatus.textContent = `Download started for ${audio.title}.`
      }
    } catch {
      if (request === generation && !disposed) {
        releasePlayback()
        actionStatus.textContent = 'The licensed audio could not be opened. Check your connection and try again.'
      }
    } finally {
      if (request === generation && !disposed) {
        actionPending = false
        setActionsDisabled(false)
      }
    }
  }

  function appendAudioActions(body, license, title) {
    const buttons = element('div', 'd-flex flex-column flex-sm-row gap-2 mt-3')
    const play = element('button', 'btn btn-outline-primary', 'Play full audio')
    const download = element('button', 'btn btn-primary', 'Download full audio')
    const player = element('audio', 'w-100 mt-3')
    player.controls = true
    player.preload = 'none'
    player.hidden = true
    player.setAttribute('aria-label', `Licensed full audio: ${title}`)
    const actionStatus = element('p', 'small mt-2 mb-0')
    actionStatus.setAttribute('role', 'status')
    actionStatus.setAttribute('aria-live', 'polite')
    for (const [button, mode] of [[play, 'play'], [download, 'download']]) {
      button.type = 'button'
      button.setAttribute('aria-label', `${button.textContent}: ${title}`)
      button.addEventListener('click', () => accessAudio(license.id, mode, player, actionStatus))
      actions.push(button)
    }
    player.addEventListener('error', () => {
      if (playback?.player !== player) return
      releasePlayback()
      actionStatus.textContent = 'This audio could not be played. Try downloading it or retry playback.'
    })
    buttons.append(play, download)
    body.append(buttons, player, actionStatus)
  }

  async function load() {
    if (disposed || loading) return
    reset()
    const request = generation
    loading = true
    refresh.disabled = true
    list.setAttribute('aria-busy', 'true')
    list.replaceChildren()
    empty.hidden = true
    error.hidden = true
    status.textContent = 'Loading your acquired licenses…'
    try {
      const result = await listMyLicenses()
      if (disposed || request !== generation) return
      if (result.error) {
        status.textContent = ''
        error.textContent = result.error.message
        error.hidden = false
        return
      }
      const licenses = result.licenses ?? []
      for (const license of licenses) {
        const column = element('div', 'col-12 col-md-6')
        const card = element('article', 'card h-100')
        const body = element('div', 'card-body text-break')
        const title = license.listing?.version?.recording?.title || 'Licensed voice recording'
        body.append(
          element('h2', 'h5', title),
          element('p', 'fw-semibold', license.license_type === 'buy' ? 'Demo Buy · perpetual nonexclusive license' : 'Demo Rent · 30-day nonexclusive license'),
          element('p', 'small text-secondary', `Demo price snapshot: ${formatEuroCents(license.price_cents)}. No real money was charged.`),
          element('p', 'small text-secondary', `Issued: ${formatTimestamp(license.created_at)}`),
          element('p', 'small', license.license_type === 'buy' ? 'No expiry.' : `Expires: ${formatTimestamp(license.expires_at)}. Rental validity is checked using database time.`),
          element('p', 'small text-secondary mb-0', `License ID: ${license.id}`),
        )
        if (license.listing?.status === 'archived') {
          body.append(element('p', 'small mt-2 mb-0', 'Listing archived. Your issued license is preserved.'))
        }
        appendAudioActions(body, license, title)
        card.append(body)
        column.append(card)
        list.append(column)
      }
      empty.hidden = licenses.length > 0
      status.textContent = licenses.length ? `${licenses.length} acquired license${licenses.length === 1 ? '' : 's'}.` : ''
    } catch {
      if (disposed || request !== generation) return
      status.textContent = ''
      error.textContent = 'Your licenses could not be loaded. Check your connection and try again.'
      error.hidden = false
    } finally {
      if (!disposed && request === generation) {
        loading = false
        refresh.disabled = false
        list.setAttribute('aria-busy', 'false')
      }
    }
  }

  refresh.addEventListener('click', load)
  const unsubscribe = subscribeToAuthState(({ user }) => {
    const nextId = user?.id ?? null
    if (accountId === undefined && nextId) { accountId = nextId; return }
    if (nextId === accountId) return
    accountId = nextId
    reset()
    empty.hidden = true
    error.hidden = true
    status.textContent = nextId ? 'Account changed. Refresh your acquired licenses.' : 'Your session ended. Sign in to access licensed audio.'
  })
  function dispose() {
    if (disposed) return
    reset()
    disposed = true
    unsubscribe()
    refresh.removeEventListener('click', load)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
  }
  function onPageHide(event) {
    if (event.persisted) reset()
    else dispose()
  }
  function onPageShow(event) {
    if (event.persisted) void load()
  }
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  return { load, dispose }
}
