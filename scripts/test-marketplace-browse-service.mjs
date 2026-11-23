import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'

// Mocked dependencies only: this suite cannot contact Supabase or change data.
const userId = '11111111-1111-4111-8111-111111111111'
const listingId = '22222222-2222-4222-8222-222222222222'
const publicFields = [
  'listing_id', 'version_id', 'recording_id', 'title', 'description', 'category',
  'seller_id', 'seller_display_name', 'effect_type', 'duration_seconds', 'mime_type',
  'sale_price_cents', 'rental_price_cents', 'rental_days', 'currency', 'preview_path', 'created_at',
]
const listing = {
  listing_id: listingId,
  title: 'Published voice',
  description: 'A public recording description',
  category: 'Speech',
  seller_display_name: 'Creator',
  effect_type: 'original',
  sale_price_cents: 1200,
  rental_price_cents: 150,
  rental_days: 30,
  currency: 'EUR',
  preview_path: `${userId}/${listingId}.wav`,
  created_at: '2026-11-23T10:00:00Z',
}
const plain = (value) => JSON.parse(JSON.stringify(value))
const forbidden = () => { throw new Error('Browsing must not upload, download private audio, invoke RPC, or write data') }

// The browse API depends on this existing constrained view rather than version
// metadata RLS. Check its source contract without executing SQL or touching data.
const policySql = await readFile(new URL('../supabase/migrations/20261121183500_rls_policies.sql', import.meta.url), 'utf8')
const viewSql = policySql.slice(policySql.indexOf('create view public.marketplace_listing_summaries'))
assert.match(viewSql, /security_barrier = true/)
assert.match(viewSql, /where l\.status = 'published'\s+and r\.visibility = 'public'\s+and l\.preview_path is not null/)
assert.doesNotMatch(viewSql.slice(0, viewSql.indexOf('comment on view')), /storage_path/)
assert.match(viewSql, /revoke all privileges on table public\.marketplace_listing_summaries\s+from public, anon, authenticated/)
assert.match(viewSql, /grant select on table public\.marketplace_listing_summaries to authenticated/)

async function loadService(stubs) {
  const context = createContext({ console })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link(async (specifier, parent) => {
      if (Object.hasOwn(stubs, specifier)) {
        const values = stubs[specifier]
        return new SyntheticModule(Object.keys(values), function () {
          for (const [name, value] of Object.entries(values)) this.setExport(name, value)
        }, { context })
      }
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL('../src/js/services/marketplaceService.js', import.meta.url))
  await module.evaluate()
  return module.namespace
}

async function setup(overrides = {}) {
  const events = []
  const state = { rows: [listing], detail: listing, ...overrides }
  const client = {
    auth: {
      async getUser() {
        events.push(['auth'])
        if (state.authThrows) throw new Error('Auth offline')
        return { data: { user: state.signedOut ? null : { id: userId } }, error: state.authError }
      },
    },
    from(table) {
      events.push(['from', table])
      assert.equal(table, 'marketplace_listing_summaries', 'browse through the existing safe projection only')
      return {
        select(fields) {
          events.push(['select', fields])
          assert.deepEqual(fields.split(','), publicFields, 'select exactly the approved public fields')
          assert.equal(fields.includes('storage_path'), false)
          return this
        },
        order(field, options) { events.push(['order', field, plain(options)]); return this },
        eq(field, value) { events.push(['eq', field, value]); return this },
        async range(start, end) {
          events.push(['range', start, end])
          if (state.queryThrows) throw new Error('Connection lost')
          const error = state.queryError && (state.errorAt === undefined || start === state.errorAt) ? state.queryError : null
          return { data: error ? null : state.rows?.slice(start, end + 1) ?? null, error }
        },
        async maybeSingle() {
          events.push(['maybeSingle'])
          if (state.queryThrows) throw new Error('Connection lost')
          return { data: state.detail, error: state.queryError }
        },
        insert: forbidden,
        update: forbidden,
        delete: forbidden,
        upsert: forbidden,
      }
    },
    storage: { from: forbidden },
    rpc: forbidden,
  }
  const service = await loadService({
    '../config/supabaseClient.js': { supabase: state.noClient ? null : client, configurationError: 'Missing Supabase configuration' },
    './audioEngine.js': { renderPublicPreview: forbidden },
    './storageService.js': { downloadOriginalAudio: forbidden },
  })
  return { service, events }
}

let test = await setup()
let result = await test.service.listMarketplaceListings()
assert.equal(result.error, null)
assert.deepEqual(plain(result.listings), [listing])
assert.deepEqual(test.events[0], ['auth'], 'verify authentication before querying data')
assert.deepEqual(test.events.filter(([name]) => name === 'order'), [
  ['order', 'created_at', { ascending: false }],
  ['order', 'listing_id', { ascending: true }],
])
assert.deepEqual(test.events.filter(([name]) => name === 'range'), [['range', 0, 199]])

const manyListings = Array.from({ length: 401 }, (_, index) => ({ ...listing, title: `Voice ${index}` }))
test = await setup({ rows: manyListings })
result = await test.service.listMarketplaceListings()
assert.equal(result.error, null)
assert.deepEqual(plain(result.listings), manyListings, 'fetch beyond the first API page before client filtering')
assert.deepEqual(test.events.filter(([name]) => name === 'range'), [
  ['range', 0, 199], ['range', 200, 399], ['range', 400, 599],
])
assert.equal(test.events.filter(([name]) => name === 'auth').length, 1)
assert.equal(test.events.filter(([name]) => name === 'select').length, 3)
assert.equal(test.events.filter(([name]) => name === 'order').length, 6)

test = await setup({ rows: manyListings.slice(0, 200) })
result = await test.service.listMarketplaceListings()
assert.equal(result.listings.length, 200, 'an exact full page is followed by an empty page')
assert.deepEqual(test.events.filter(([name]) => name === 'range'), [['range', 0, 199], ['range', 200, 399]])

for (const rows of [[], null]) {
  test = await setup({ rows })
  result = await test.service.listMarketplaceListings()
  assert.equal(result.error, null)
  assert.deepEqual(plain(result.listings), [])
}

for (const [overrides, expectedCode] of [
  [{ noClient: true }, 'configuration'],
  [{ signedOut: true }, 'authentication_required'],
  [{ authError: { message: 'Invalid token' } }, 'authentication_required'],
  [{ authThrows: true }, 'authentication_error'],
]) {
  test = await setup(overrides)
  result = await test.service.listMarketplaceListings()
  assert.equal(result.listings, null)
  assert.equal(result.error.code, expectedCode)
  assert.equal(test.events.some(([name]) => name === 'from'), false)
  assert.doesNotMatch(result.error.message, /publish|manage/)
  result = await test.service.getMarketplaceListing(listingId)
  assert.equal(result.listing, null)
  assert.equal(result.error.code, expectedCode)
  assert.equal(test.events.some(([name]) => name === 'from'), false)
}

for (const queryError of [
  { code: '42501' }, { status: 401 }, { statusCode: '403' },
  { code: 'PGRST301' }, { code: 'PGRST302' }, { code: 'PGRST303' },
]) {
  test = await setup({ queryError })
  assert.equal((await test.service.listMarketplaceListings()).error.code, 'access_denied')
  assert.equal((await test.service.getMarketplaceListing(listingId)).error.code, 'access_denied')
}

test = await setup({ rows: manyListings, errorAt: 200, queryError: { message: 'sensitive database details', code: 'XX000' } })
result = await test.service.listMarketplaceListings()
assert.equal(result.listings, null, 'do not present a partial catalogue as complete after later-page failure')
assert.equal(result.error.code, 'load_failed')
assert.equal(result.error.message.includes('sensitive database details'), false)

test = await setup({ queryThrows: true })
assert.equal((await test.service.listMarketplaceListings()).error.code, 'load_failed')
assert.equal((await test.service.getMarketplaceListing(listingId)).error.code, 'load_failed')

for (const invalidId of [undefined, null, '', 'not-a-uuid', `${listingId},status.eq.archived`, '../voice-files/private.wav']) {
  test = await setup()
  result = await test.service.getMarketplaceListing(invalidId)
  assert.equal(result.listing, null)
  assert.equal(result.error.code, 'invalid_listing')
  assert.deepEqual(test.events, [], 'reject invalid identifiers before auth or database requests')
}

test = await setup()
result = await test.service.getMarketplaceListing(listingId)
assert.equal(result.error, null)
assert.deepEqual(plain(result.listing), listing)
assert.deepEqual(test.events.filter(([name]) => name === 'eq'), [['eq', 'listing_id', listingId]])
assert.equal(test.events.some(([name]) => ['range', 'order'].includes(name)), false)

// Missing IDs and records hidden by the published/public projection are indistinguishable.
const unavailableResults = []
for (const reason of ['missing', 'draft', 'archived', 'private recording']) {
  test = await setup({ detail: null })
  result = await test.service.getMarketplaceListing(listingId)
  assert.equal(result.listing, null, reason)
  assert.equal(result.error.code, 'not_found', reason)
  unavailableResults.push(plain(result))
}
for (const unavailable of unavailableResults) assert.deepEqual(unavailable, unavailableResults[0])

test = await setup({ queryError: { code: 'XX000', message: 'private source URL must stay hidden' } })
result = await test.service.getMarketplaceListing(listingId)
assert.equal(result.error.code, 'load_failed')
assert.equal(result.error.message.includes('private source URL'), false)

console.log('Marketplace browse service tests passed (safe public projection, complete stable paging, auth/config/error states, validated IDs, hidden/missing details, and no private audio or write operations).')
