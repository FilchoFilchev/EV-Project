import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAuthentication } from '../utils/routeGuard.js'
import { createPreviewPlayer, createPriceList, pauseMarketplacePreviews } from '../components/voiceCard.js'
import { createDemoCheckout } from '../components/demoCheckout.js'
import { createListingReportForm } from '../components/listingReport.js'
import { getMarketplaceListing } from '../services/marketplaceService.js'
import { formatMarketplaceDate, getEffectName } from '../utils/marketplaceFilters.js'

renderNavbar('marketplace')
renderFooter()
initPageTransitions()

const heading = document.querySelector('#details-title')
const status = document.querySelector('#details-status')
const errorBox = document.querySelector('#details-error')
const errorMessage = document.querySelector('#details-error-message')
const retryButton = document.querySelector('#details-retry')
const content = document.querySelector('#details-content')
const listingId = new URLSearchParams(window.location.search).get('id')
let loading = false
let currentUser = null

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderDetails(listing) {
  heading.textContent = listing.title
  document.title = `${listing.title} | EchoVault`
  const primary = element('div', 'col-12 col-lg-7')
  const card = element('article', 'card')
  const body = element('div', 'card-body')
  const metadata = element('dl', 'marketplace-details-meta small mb-4')
  const duration = Number(listing.duration_seconds)
  const values = [
    ['Creator', listing.seller_display_name || 'EchoVault creator'],
    ['Category', listing.category],
    ['Effect', getEffectName(listing.effect_type)],
    ['Published', formatMarketplaceDate(listing.created_at)],
    ['Full recording', Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(1)} seconds` : 'Duration unavailable'],
  ]
  for (const [label, value] of values) metadata.append(element('dt', 'text-secondary', label), element('dd', '', value))
  body.append(
    element('h2', 'h5 mb-3', 'About this voice'),
    metadata,
    element('p', 'marketplace-description text-secondary mb-4', listing.description || 'No description provided.'),
    createPreviewPlayer(listing),
  )
  card.append(body)
  primary.append(card)

  const secondary = element('div', 'col-12 col-lg-5')
  const offers = element('section', 'card')
  const offerBody = element('div', 'card-body')
  offerBody.append(element('h2', 'h5 mb-3', 'Demo license offers'), createPriceList(listing))
  offerBody.append(createDemoCheckout(listing, { userId: currentUser?.id }), element('hr'), element('h3', 'h6', 'License terms'))
  const terms = element('ul', 'small text-secondary ps-3 mb-3')
  if (listing.sale_price_cents != null) terms.append(element('li', 'mb-2', 'Demo Buy offers a perpetual, nonexclusive license to use this specific audio file. It does not transfer ownership of the creator’s voice.'))
  if (listing.rental_price_cents != null) terms.append(element('li', 'mb-2', 'Demo Rent offers a license for 30 days. After expiry, new downloads stop; previously downloaded copies cannot be removed.'))
  terms.append(element('li', '', 'Archiving a listing preserves licenses already issued.'))
  offerBody.append(terms, createListingReportForm(listing, { userId: currentUser?.id }))
  offers.append(offerBody)
  secondary.append(offers)
  content.replaceChildren(primary, secondary)
}

async function loadDetails() {
  if (loading) return
  loading = true
  retryButton.disabled = true
  errorBox.hidden = true
  content.hidden = true
  content.setAttribute('aria-busy', 'true')
  status.textContent = 'Loading listing details…'
  pauseMarketplacePreviews(content)
  content.replaceChildren()
  const result = await getMarketplaceListing(listingId)
  loading = false
  retryButton.disabled = false
  content.setAttribute('aria-busy', 'false')
  status.textContent = ''
  if (result.error || !result.listing) {
    errorMessage.textContent = result.error?.message || 'This listing is unavailable or you do not have permission to view it.'
    errorBox.hidden = false
    retryButton.hidden = ['authentication_required', 'access_denied', 'configuration', 'invalid_listing', 'not_found'].includes(result.error?.code)
    return
  }
  renderDetails(result.listing)
  content.hidden = false
}

retryButton.addEventListener('click', loadDetails)
window.addEventListener('pagehide', () => pauseMarketplacePreviews())

async function initializeDetails() {
  const user = await requireAuthentication()
  if (user) {
    currentUser = user
    await loadDetails()
  }
}

initializeDetails()
