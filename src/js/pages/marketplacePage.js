import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { renderNavbar } from '../components/navbar.js'
import { renderFooter } from '../components/footer.js'
import { initPageTransitions } from '../utils/pageTransitions.js'
import { requireAuthentication } from '../utils/routeGuard.js'
import { createVoiceCard, pauseMarketplacePreviews } from '../components/voiceCard.js'
import { listMarketplaceListings } from '../services/marketplaceService.js'
import { filterMarketplaceListings, getMarketplaceCategories, readMarketplaceFilters } from '../utils/marketplaceFilters.js'

renderNavbar('marketplace')
renderFooter()
initPageTransitions()

const form = document.querySelector('#marketplace-filters')
const fields = document.querySelector('#marketplace-filter-fields')
const searchInput = document.querySelector('#market-search')
const categoryInput = document.querySelector('#category-filter')
const licenseInput = document.querySelector('#license-filter')
const minPriceInput = document.querySelector('#min-price-filter')
const maxPriceInput = document.querySelector('#max-price-filter')
const filterError = document.querySelector('#marketplace-filter-error')
const status = document.querySelector('#marketplace-status')
const errorBox = document.querySelector('#marketplace-error')
const errorMessage = document.querySelector('#marketplace-error-message')
const retryButton = document.querySelector('#marketplace-retry')
const empty = document.querySelector('#marketplace-empty')
const emptyMessage = document.querySelector('#marketplace-empty-message')
const list = document.querySelector('#marketplace-list')
let listings = []
let loading = false

function applyFilters() {
  const result = readMarketplaceFilters({
    search: searchInput.value,
    category: categoryInput.value,
    license: licenseInput.value,
    minPrice: minPriceInput.value,
    maxPrice: maxPriceInput.value,
  })
  filterError.textContent = result.error ?? ''
  filterError.hidden = !result.error
  minPriceInput.setAttribute('aria-invalid', String(Boolean(result.error)))
  maxPriceInput.setAttribute('aria-invalid', String(Boolean(result.error)))
  if (result.error) return

  const matches = filterMarketplaceListings(listings, result.filters)
  pauseMarketplacePreviews(list)
  list.replaceChildren(...matches.map(createVoiceCard))
  empty.hidden = matches.length > 0
  emptyMessage.textContent = listings.length === 0
    ? 'No published listings are available yet. Check back after a creator publishes a voice.'
    : 'No listings match these filters. Try a different search, category, license, or price range.'
  status.textContent = `${matches.length} listing${matches.length === 1 ? '' : 's'} shown${matches.length !== listings.length ? ` of ${listings.length}` : ''}.`
}

async function loadMarketplace() {
  if (loading) return
  loading = true
  fields.disabled = true
  retryButton.disabled = true
  errorBox.hidden = true
  empty.hidden = true
  status.textContent = 'Loading marketplace listings…'
  list.setAttribute('aria-busy', 'true')
  pauseMarketplacePreviews(list)
  list.replaceChildren()
  const result = await listMarketplaceListings()
  loading = false
  retryButton.disabled = false
  list.setAttribute('aria-busy', 'false')
  if (result.error) {
    status.textContent = ''
    errorMessage.textContent = result.error.message
    errorBox.hidden = false
    retryButton.hidden = ['authentication_required', 'access_denied', 'configuration'].includes(result.error.code)
    return
  }

  listings = result.listings ?? []
  const previousCategory = categoryInput.value
  const allCategories = document.createElement('option')
  allCategories.value = ''
  allCategories.textContent = 'All categories'
  const options = getMarketplaceCategories(listings).map((category) => {
    const option = document.createElement('option')
    option.value = category
    option.textContent = category
    return option
  })
  categoryInput.replaceChildren(allCategories, ...options)
  categoryInput.value = getMarketplaceCategories(listings).includes(previousCategory) ? previousCategory : ''
  fields.disabled = false
  applyFilters()
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  if (!loading && !fields.disabled) applyFilters()
})
document.querySelector('#marketplace-clear').addEventListener('click', () => {
  form.reset()
  applyFilters()
})
retryButton.addEventListener('click', loadMarketplace)
window.addEventListener('pagehide', () => pauseMarketplacePreviews())

async function initializeMarketplace() {
  const user = await requireAuthentication()
  if (user) await loadMarketplace()
}

initializeMarketplace()
