import { MAX_PRICE_CENTS, parseEuroPrice } from './listingValidation.js'

function readPriceBound(value) {
  if (typeof value !== 'string') return { cents: null, error: 'Enter a valid EUR price.' }
  // Zero is a valid search bound, although a published offer must have a positive price.
  if (/^0{1,8}(?:[.,]0{1,2})?$/.test(value.trim())) return { cents: 0, error: null }
  return parseEuroPrice(value)
}

export function readMarketplaceFilters({ search = '', category = '', license = 'all', minPrice = '', maxPrice = '' } = {}) {
  if (typeof search !== 'string' || search.trim().length > 120 || typeof category !== 'string' || category.length > 80) {
    return { filters: null, error: 'Search by a title or category of up to 120 characters.' }
  }
  if (!['all', 'buy', 'rent'].includes(license)) return { filters: null, error: 'Choose a valid license offer.' }
  const minimum = readPriceBound(minPrice)
  const maximum = readPriceBound(maxPrice)
  if (minimum.error || maximum.error) return { filters: null, error: minimum.error || maximum.error }
  if (minimum.cents !== null && maximum.cents !== null && minimum.cents > maximum.cents) {
    return { filters: null, error: 'The minimum price must not exceed the maximum price.' }
  }
  return {
    filters: { search: search.trim().toLocaleLowerCase(), category, license, minCents: minimum.cents, maxCents: maximum.cents },
    error: null,
  }
}

export function filterMarketplaceListings(listings, filters) {
  return listings.filter((listing) => {
    if (filters.category && listing.category !== filters.category) return false
    if (filters.search && ![listing.title, listing.category].some((value) => String(value ?? '').toLocaleLowerCase().includes(filters.search))) return false
    const offers = filters.license === 'buy' ? [listing.sale_price_cents]
      : filters.license === 'rent' ? [listing.rental_price_cents]
        : [listing.sale_price_cents, listing.rental_price_cents]
    // Price and license must match the same offer, rather than different offers on a listing.
    return offers.some((cents) => Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_PRICE_CENTS &&
      (filters.minCents === null || cents >= filters.minCents) && (filters.maxCents === null || cents <= filters.maxCents))
  })
}

export function getMarketplaceCategories(listings) {
  return [...new Set(listings.map((listing) => listing.category).filter((category) => typeof category === 'string' && category.trim()))]
    .sort((left, right) => left.localeCompare(right))
}

export function formatEuroCents(cents) {
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_PRICE_CENTS
    ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
    : 'Price unavailable'
}

export function getEffectName(effect) {
  return new Map([['original', 'Original'], ['muffle', 'Muffle'], ['distortion', 'Distortion'], ['echo', 'Echo']]).get(effect) ?? 'Unknown effect'
}

export function formatMarketplaceDate(value) {
  const date = typeof value === 'string' && value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
    : 'Date unavailable'
}
