import {
  archiveMyListing,
  getPublicPreviewUrl,
  listMyListings,
  prepareListingPreview,
  publishVoiceListing,
} from '../services/marketplaceService.js'

const effectNames = { original: 'Original', muffle: 'Muffle', distortion: 'Distortion', echo: 'Echo' }
const formatPrice = (cents) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(cents / 100)

export function initListingPublisher() {
  const select = (id) => document.querySelector(`#${id}`)
  const panel = select('listing-publisher')
  const heading = select('listing-publisher-heading')
  const title = select('listing-publisher-title')
  const form = select('listing-publish-form')
  const fields = select('listing-publish-fields')
  const start = select('listing-preview-start')
  const duration = select('listing-preview-duration')
  const generate = select('listing-generate-preview')
  const player = select('listing-local-preview')
  const saleEnabled = select('listing-sale-enabled')
  const rentalEnabled = select('listing-rental-enabled')
  const salePrice = select('listing-sale-price')
  const rentalPrice = select('listing-rental-price')
  const publicConfirmed = select('listing-public-confirmed')
  const rightsConfirmed = select('listing-rights-confirmed')
  const submit = select('listing-publish-submit')
  const cancel = select('listing-publish-cancel')
  const status = select('listing-publish-status')
  const error = select('listing-publish-error')
  const list = select('my-listings-list')
  const listStatus = select('my-listings-status')
  const listError = select('my-listings-error')
  const empty = select('my-listings-empty')
  const refresh = select('my-listings-refresh')

  let selected = null
  let preview = null
  let previewUrl = null
  let busy = false
  let operation = 0
  let listRequest = 0
  const listingPlayers = new Set()

  function releaseListingPlayers(clearSources = true) {
    listingPlayers.forEach((audio) => {
      audio.pause()
      if (clearSources) {
        audio.removeAttribute('src')
        audio.load()
      }
    })
    if (clearSources) listingPlayers.clear()
  }

  function showError(message = '') {
    error.textContent = message
    error.hidden = !message
  }

  function syncControls() {
    fields.disabled = busy
    salePrice.disabled = !saleEnabled.checked
    salePrice.required = saleEnabled.checked
    rentalPrice.disabled = !rentalEnabled.checked
    rentalPrice.required = rentalEnabled.checked
    submit.disabled = busy || !preview
    generate.disabled = busy || !selected
  }

  function clearPreview() {
    preview = null
    player.pause()
    player.removeAttribute('src')
    player.load()
    player.hidden = true
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    previewUrl = null
    syncControls()
  }

  function invalidatePreview() {
    if (busy) return
    clearPreview()
    showError()
    status.textContent = 'Generate a new preview after changing the start time or length.'
  }

  function open(version) {
    if (busy) return
    if (!version?.versionId || !Number.isFinite(version.durationSeconds) || version.durationSeconds < 5) return
    operation += 1
    selected = version
    clearPreview()
    form.reset()
    start.value = '0'
    start.max = String(Math.max(0, version.durationSeconds - 5))
    duration.value = '5'
    duration.max = String(Math.min(8, version.durationSeconds))
    saleEnabled.checked = true
    rentalEnabled.checked = false
    salePrice.value = ''
    rentalPrice.value = ''
    publicConfirmed.checked = false
    rightsConfirmed.checked = false
    title.textContent = `${version.title} · ${version.durationSeconds.toFixed(3).replace(/\.?0+$/, '')} seconds`
    status.textContent = 'Choose a short excerpt and generate its public preview.'
    showError()
    panel.hidden = false
    syncControls()
    heading.focus()
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function generatePreview() {
    if (busy || !selected) return
    showError()
    const startSeconds = Number(start.value)
    const durationSeconds = Number(duration.value)
    if (start.value.trim() === '' || duration.value.trim() === '' ||
      !Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds) || startSeconds < 0 ||
      durationSeconds < 5 || durationSeconds > 8 || startSeconds + durationSeconds > selected.durationSeconds + 0.001) {
      showError('Choose a 5–8 second excerpt that fits within this saved audio.')
      return
    }
    clearPreview()
    busy = true
    syncControls()
    status.textContent = 'Loading your private version and generating the short preview...'
    const request = ++operation
    try {
      const result = await prepareListingPreview({ versionId: selected.versionId, startSeconds, durationSeconds })
      if (request !== operation) return
      if (result.error || !result.preview?.blob) {
        showError(result.error?.message || 'The preview could not be generated. Please try again.')
        status.textContent = ''
        return
      }
      preview = result.preview
      previewUrl = URL.createObjectURL(preview.blob)
      player.src = previewUrl
      player.hidden = false
      player.load()
      status.textContent = `Your ${preview.durationSeconds} second preview is ready. Listen to it, set your demo prices, and confirm publication.`
    } catch {
      if (request === operation) {
        showError('The preview could not be generated. Check your connection and audio format.')
        status.textContent = ''
      }
    } finally {
      if (request === operation) {
        busy = false
        syncControls()
      }
    }
  }

  async function publish(event) {
    event.preventDefault()
    if (busy || !preview || !selected) return
    showError()
    if (!saleEnabled.checked && !rentalEnabled.checked) {
      showError('Enable at least one demo sale or 30-day rental option.')
      return
    }
    if (!publicConfirmed.checked || !rightsConfirmed.checked) {
      showError('Confirm public recording information and your voice publication rights before publishing.')
      return
    }
    if (!form.reportValidity()) return
    busy = true
    syncControls()
    status.textContent = 'Uploading the short public preview and publishing your demo listing...'
    const request = ++operation
    try {
      const result = await publishVoiceListing({
        preview,
        salePrice: saleEnabled.checked ? salePrice.value : '',
        rentalPrice: rentalEnabled.checked ? rentalPrice.value : '',
        rightsConfirmed: rightsConfirmed.checked,
        publicConfirmed: publicConfirmed.checked,
      })
      if (request !== operation) return
      if (result.error || !result.listing) {
        showError(result.error?.message || 'The listing could not be published. Check My listings before retrying.')
        status.textContent = ''
        if (result.error?.outcomeUnknown) clearPreview()
        return
      }
      clearPreview()
      selected = null
      status.textContent = 'Demo listing published. Your full audio remains private. Open My listings to review it.'
      await loadListings()
    } catch {
      if (request === operation) {
        showError('Publication could not be confirmed. Refresh My listings before retrying.')
        status.textContent = ''
        clearPreview()
      }
    } finally {
      if (request === operation) {
        busy = false
        syncControls()
      }
    }
  }

  function createListingCard(listing) {
    const column = document.createElement('div')
    column.className = 'col-12 col-md-6'
    const card = document.createElement('article')
    card.className = 'card library-recording-card'
    const body = document.createElement('div')
    body.className = 'card-body'
    const recording = listing.version?.recording
    const name = recording?.title || 'Voice listing'
    const cardHeading = document.createElement('h2')
    cardHeading.className = 'h5 listing-text'
    cardHeading.textContent = name
    const metadata = document.createElement('p')
    metadata.className = 'small text-secondary listing-text'
    metadata.textContent = `${recording?.category || 'Audio'} · ${effectNames[listing.version?.effect_type] || 'Voice version'} · ${listing.status}`
    const prices = document.createElement('p')
    prices.className = 'small fw-semibold'
    const offers = []
    if (listing.sale_price_cents != null) offers.push(`Demo sale ${formatPrice(listing.sale_price_cents)}`)
    if (listing.rental_price_cents != null) offers.push(`Demo rental ${formatPrice(listing.rental_price_cents)} / 30 days`)
    prices.textContent = offers.join(' · ')
    body.append(cardHeading, metadata, prices)

    const url = getPublicPreviewUrl(listing.preview_path)
    if (url) {
      const audio = document.createElement('audio')
      audio.className = 'library-audio-player mb-3'
      audio.controls = true
      audio.preload = 'none'
      audio.src = url
      audio.setAttribute('aria-label', `Public preview for ${name}`)
      listingPlayers.add(audio)
      body.append(audio)
    } else {
      const unavailable = document.createElement('p')
      unavailable.className = 'small text-secondary'
      unavailable.textContent = 'Public preview unavailable.'
      body.append(unavailable)
    }

    if (listing.status !== 'archived') {
      const archive = document.createElement('button')
      archive.type = 'button'
      archive.className = 'btn btn-outline-secondary mt-auto align-self-start'
      archive.textContent = 'Archive listing'
      archive.setAttribute('aria-label', `Archive listing for ${name}`)
      const confirmation = document.createElement('div')
      confirmation.className = 'listing-archive-confirmation mt-3'
      confirmation.hidden = true
      const explanation = document.createElement('p')
      explanation.className = 'small'
      explanation.textContent = 'Remove this offer from the catalogue? Existing licenses and full audio are preserved.'
      const confirm = document.createElement('button')
      confirm.type = 'button'
      confirm.className = 'btn btn-outline-danger me-2'
      confirm.textContent = 'Confirm archive'
      const keep = document.createElement('button')
      keep.type = 'button'
      keep.className = 'btn btn-outline-secondary'
      keep.textContent = 'Keep listing'
      const archiveStatus = document.createElement('p')
      archiveStatus.className = 'small text-secondary mt-2 mb-0'
      archiveStatus.setAttribute('role', 'status')
      archiveStatus.setAttribute('aria-live', 'polite')
      archive.addEventListener('click', () => {
        confirmation.hidden = false
        archive.hidden = true
        confirm.focus()
      })
      keep.addEventListener('click', () => {
        confirmation.hidden = true
        archive.hidden = false
        archive.focus()
      })
      confirm.addEventListener('click', async () => {
        if (confirm.disabled) return
        confirm.disabled = true
        keep.disabled = true
        archiveStatus.textContent = 'Archiving listing...'
        try {
          const result = await archiveMyListing(listing.id)
          if (result.error || !result.listing) {
            archiveStatus.textContent = result.error?.message || 'Archive could not be confirmed. Refresh your listings.'
            return
          }
          await loadListings()
        } catch {
          archiveStatus.textContent = 'Archive could not be confirmed. Refresh your listings.'
        } finally {
          confirm.disabled = false
          keep.disabled = false
        }
      })
      confirmation.append(explanation, confirm, keep, archiveStatus)
      body.append(archive, confirmation)
    }
    card.append(body)
    column.append(card)
    return column
  }

  async function loadListings() {
    const request = ++listRequest
    listStatus.textContent = 'Loading your listings...'
    listError.hidden = true
    listError.textContent = ''
    refresh.disabled = true
    try {
      const result = await listMyListings()
      if (request !== listRequest) return
      if (result.error) {
        releaseListingPlayers()
        list.replaceChildren()
        empty.hidden = true
        listStatus.textContent = ''
        listError.textContent = result.error.message
        listError.hidden = false
        return
      }
      const listings = result.listings || []
      releaseListingPlayers()
      const fragment = document.createDocumentFragment()
      listings.forEach((listing) => fragment.append(createListingCard(listing)))
      list.replaceChildren(fragment)
      empty.hidden = listings.length > 0
      listStatus.textContent = listings.length ? `${listings.length} demo listing${listings.length === 1 ? '' : 's'}. No real payments.` : ''
    } catch {
      if (request === listRequest) {
        releaseListingPlayers()
        list.replaceChildren()
        empty.hidden = true
        listStatus.textContent = ''
        listError.textContent = 'Your listings could not be loaded. Check your connection and refresh.'
        listError.hidden = false
      }
    } finally {
      if (request === listRequest) refresh.disabled = false
    }
  }

  function dispose() {
    operation += 1
    listRequest += 1
    busy = false
    refresh.disabled = false
    clearPreview()
    // Keep remote sources usable if this page returns from the browser's back/forward cache.
    releaseListingPlayers(false)
  }

  start.addEventListener('input', invalidatePreview)
  duration.addEventListener('input', invalidatePreview)
  saleEnabled.addEventListener('change', syncControls)
  rentalEnabled.addEventListener('change', syncControls)
  generate.addEventListener('click', generatePreview)
  form.addEventListener('submit', publish)
  refresh.addEventListener('click', loadListings)
  cancel.addEventListener('click', () => {
    if (busy) return
    operation += 1
    clearPreview()
    selected = null
    panel.hidden = true
    syncControls()
  })
  syncControls()
  return { open, loadListings, dispose }
}
