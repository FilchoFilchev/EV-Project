import { getPublicPreviewUrl } from '../services/marketplaceService.js'
import { formatEuroCents, getEffectName } from '../utils/marketplaceFilters.js'

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function pauseMarketplacePreviews(root = document) {
  root.querySelectorAll('audio[data-marketplace-preview]').forEach((audio) => audio.pause())
}

export function createPreviewPlayer(listing) {
  const section = element('div', 'marketplace-preview')
  const label = element('p', 'small fw-semibold mb-2', 'Public preview')
  const message = element('p', 'small text-secondary mb-0')
  section.append(label)
  const previewUrl = getPublicPreviewUrl(listing.preview_path)
  if (!previewUrl) {
    message.textContent = 'A playable public preview is unavailable for this listing.'
    section.append(message)
    return section
  }

  const player = document.createElement('audio')
  player.controls = true
  player.preload = 'none'
  player.setAttribute('data-marketplace-preview', '')
  player.setAttribute('aria-label', `Public preview of ${listing.title}`)
  player.src = previewUrl
  player.textContent = 'Your browser does not support audio playback.'
  message.className = 'small text-secondary mt-2 mb-0'
  message.textContent = 'Short excerpt only. The full audio remains private.'
  message.setAttribute('role', 'status')
  player.addEventListener('play', () => {
    document.querySelectorAll('audio[data-marketplace-preview]').forEach((other) => {
      if (other !== player) other.pause()
    })
    message.textContent = 'Playing the public preview. The full audio remains private.'
  })
  player.addEventListener('error', () => {
    message.textContent = 'This public preview could not be played. Check your connection or try another listing.'
  })
  section.append(player, message)
  return section
}

export function createPriceList(listing) {
  const prices = element('dl', 'marketplace-price-list small')
  const offers = [
    ['Demo Buy', listing.sale_price_cents],
    ['Demo Rent · 30 days', listing.rental_price_cents],
  ]
  for (const [label, cents] of offers) {
    if (cents === null || cents === undefined) continue
    prices.append(element('dt', 'fw-normal text-secondary', label), element('dd', '', formatEuroCents(cents)))
  }
  return prices
}

export function createVoiceCard(listing) {
  const column = element('div', 'col-12 col-md-6 col-xl-4')
  const card = element('article', 'card marketplace-card')
  const body = element('div', 'card-body')
  const heading = element('h2', 'h5 mb-0', listing.title)
  const metadata = element('div', 'd-flex flex-wrap gap-2')
  metadata.append(
    element('span', 'marketplace-badge', listing.category),
    element('span', 'marketplace-badge', getEffectName(listing.effect_type)),
  )
  const author = element('p', 'small text-secondary mb-0', `By ${listing.seller_display_name || 'EchoVault creator'}`)
  const actions = element('div', 'marketplace-card-actions')
  const detailLink = element('a', 'btn btn-outline-primary w-100', 'View details')
  detailLink.href = `/voice-details.html?id=${encodeURIComponent(listing.listing_id)}`
  detailLink.setAttribute('aria-label', `View details for ${listing.title}`)
  actions.append(detailLink)
  body.append(heading, metadata, author, createPreviewPlayer(listing), createPriceList(listing), actions)
  card.append(body)
  column.append(card)
  return column
}
