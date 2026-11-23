import assert from 'node:assert/strict'
import { readMarketplaceFilters, filterMarketplaceListings, getMarketplaceCategories, formatEuroCents, getEffectName, formatMarketplaceDate } from '../src/js/utils/marketplaceFilters.js'

const listings = [
  { listing_id: 'a', title: 'Warm narration', category: 'Speech', sale_price_cents: 1000, rental_price_cents: 200 },
  { listing_id: 'b', title: 'Robot voice', category: 'Effects', sale_price_cents: 500, rental_price_cents: null },
  { listing_id: 'c', title: 'Soft singing', category: 'Music', sale_price_cents: null, rental_price_cents: 350 },
  { listing_id: 'd', title: '100%_literal,(query)', category: 'Speech', sale_price_cents: 1234, rental_price_cents: null },
]
function matches(input = {}) {
  const result = readMarketplaceFilters(input)
  assert.equal(result.error, null)
  return filterMarketplaceListings(listings, result.filters).map((listing) => listing.listing_id)
}
assert.deepEqual(matches(), ['a', 'b', 'c', 'd'])
assert.deepEqual(matches({ search: ' WARM ' }), ['a'])
assert.deepEqual(matches({ search: 'sPEeCh' }), ['a', 'd'])
assert.deepEqual(matches({ search: '100%_literal,(query)' }), ['d'])
assert.deepEqual(matches({ category: 'Music' }), ['c'])
assert.deepEqual(matches({ category: 'missing' }), [])
assert.deepEqual(matches({ license: 'rent' }), ['a', 'c'])
assert.deepEqual(matches({ license: 'buy', maxPrice: '5.00' }), ['b'])
assert.deepEqual(matches({ license: 'buy', maxPrice: '2' }), []) // Rental price must not satisfy Buy.
assert.deepEqual(matches({ minPrice: '3.50', maxPrice: '5,00' }), ['b', 'c'])
assert.deepEqual(matches({ minPrice: '12.34', maxPrice: '12.34' }), ['d'])
assert.deepEqual(matches({ maxPrice: '0.00' }), [])
assert.deepEqual(matches({ minPrice: '0' }), ['a', 'b', 'c', 'd'])
assert.deepEqual(matches({ search: 'Robot', category: 'Effects', license: 'buy', minPrice: '5', maxPrice: '5' }), ['b'])
for (const input of [{ minPrice: '-1' }, { maxPrice: '1.001' }, { maxPrice: '1e2' }, { maxPrice: '21474836.48' }, { minPrice: '5', maxPrice: '4' }, { license: 'invalid' }, { search: 'x'.repeat(121) }, { search: null }]) {
  assert.ok(readMarketplaceFilters(input).error, JSON.stringify(input))
}
assert.deepEqual(getMarketplaceCategories(listings), ['Effects', 'Music', 'Speech'])
assert.deepEqual(listings.map((listing) => listing.listing_id), ['a', 'b', 'c', 'd']) // Filtering leaves source data intact.
assert.match(formatEuroCents(1234), /12\.34/)
assert.equal(formatEuroCents(null), 'Price unavailable')
for (const name of ['original', 'muffle', 'distortion', 'echo']) assert.equal(getEffectName(name).toLowerCase(), name)
assert.equal(getEffectName('__proto__'), 'Unknown effect')
assert.equal(formatMarketplaceDate(null), 'Date unavailable')
assert.equal(formatMarketplaceDate('invalid'), 'Date unavailable')
assert.notEqual(formatMarketplaceDate('2026-11-23T12:00:00Z'), 'Date unavailable')
console.log('PASS: Marketplace search, category, license/price intersection, validation, and formatting.')
