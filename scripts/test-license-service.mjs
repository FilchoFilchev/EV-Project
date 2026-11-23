import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'

// Dependency mocks only: these tests cannot contact Supabase or change data.
const userId = '11111111-1111-4111-8111-111111111111'
const listingId = '22222222-2222-4222-8222-222222222222'
const licenseId = '33333333-3333-4333-8333-333333333333'
const oldId = '44444444-4444-4444-8444-444444444444'
const otherId = '55555555-5555-4555-8555-555555555555'
const receipt = {
  id: licenseId, listing_id: listingId, buyer_id: userId, license_type: 'buy',
  price_cents: 1299, created_at: '2026-11-23T10:00:00Z', expires_at: null,
  listing: { id: listingId, status: 'published', version: { recording: { title: 'Licensed voice' } } },
}
const rental = { ...receipt, license_type: 'rent', price_cents: 199, expires_at: '2026-12-23T10:00:00Z' }
const plain = (value) => JSON.parse(JSON.stringify(value))
const forbidden = () => { throw new Error('Only demo_checkout may create a license; no direct writes or Storage access') }

async function loadService(client, noClient = false) {
  const context = createContext({ console })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link(async (specifier, parent) => {
      if (specifier === '../config/supabaseClient.js') {
        return new SyntheticModule(['supabase', 'configurationError'], function () {
          this.setExport('supabase', noClient ? null : client)
          this.setExport('configurationError', 'Missing Supabase configuration')
        }, { context })
      }
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL('../src/js/services/licenseService.js', import.meta.url))
  await module.evaluate()
  return module.namespace
}

async function setup(overrides = {}) {
  const state = { rows: [receipt], before: [], after: [], detail: receipt, ...overrides }
  const events = []
  let rpcSubmitted = false
  const client = {
    auth: { async getUser() {
      events.push(['auth'])
      if (state.authThrows) throw new Error('Auth offline')
      return { data: { user: state.signedOut ? null : { id: userId } }, error: state.authError }
    } },
    from(table) {
      events.push(['from', table])
      assert.equal(table, 'licenses')
      const filters = []
      return {
        select(fields) {
          events.push(['select', fields])
          assert.doesNotMatch(fields, /storage_path|preview_path|email|\*|!inner/)
          assert.match(fields, /^id,listing_id,buyer_id,license_type,price_cents,created_at,expires_at/)
          return this
        },
        eq(key, value) { filters.push([key, value]); events.push(['eq', key, value]); return this },
        order(key, options) { events.push(['order', key, plain(options)]); return this },
        async range(start, end) {
          events.push(['range', start, end])
          assert.ok(filters.some(([key, value]) => key === 'buyer_id' && value === userId))
          if (state.queryThrows) throw new Error('Read offline')
          return { data: state.rows.slice(start, end + 1), error: state.queryError }
        },
        async maybeSingle() {
          events.push(['maybeSingle'])
          assert.ok(filters.some(([key, value]) => key === 'buyer_id' && value === userId))
          assert.ok(filters.some(([key, value]) => key === 'id' && value === licenseId))
          if (state.queryThrows) throw new Error('Read offline')
          return { data: state.detail, error: state.queryError }
        },
        then(resolve, reject) {
          events.push(['matching', rpcSubmitted ? 'after' : 'before'])
          assert.ok(filters.some(([key, value]) => key === 'buyer_id' && value === userId))
          assert.ok(filters.some(([key, value]) => key === 'listing_id' && value === listingId))
          assert.ok(filters.some(([key, value]) => key === 'license_type' && ['buy', 'rent'].includes(value)))
          if (state.queryThrows || (rpcSubmitted && state.afterThrows)) return Promise.reject(new Error('Read offline')).then(resolve, reject)
          return Promise.resolve({ data: rpcSubmitted ? state.after : state.before, error: state.queryError }).then(resolve, reject)
        },
        insert: forbidden, update: forbidden, delete: forbidden, upsert: forbidden,
      }
    },
    async rpc(name, args) {
      rpcSubmitted = true
      events.push(['rpc', name, plain(args)])
      assert.equal(name, 'demo_checkout')
      assert.deepEqual(Object.keys(args).sort(), ['p_license_type', 'p_listing_id'])
      assert.equal(args.p_listing_id, listingId)
      if (state.rpcThrows) throw new Error('Response lost')
      return { data: state.rpcError ? null : Object.hasOwn(state, 'rpcData') ? state.rpcData : licenseId, error: state.rpcError }
    },
    storage: { from: forbidden },
  }
  return { service: await loadService(client, state.noClient), events, state }
}

let test = await setup()
let result = await test.service.demoCheckout({ listingId, licenseType: 'buy' })
assert.equal(result.error, null)
assert.equal(result.licenseId, licenseId)
assert.deepEqual(test.events[0], ['auth'])
assert.deepEqual(test.events.find(([event]) => event === 'rpc'), ['rpc', 'demo_checkout', { p_listing_id: listingId, p_license_type: 'buy' }])

test = await setup()
result = await test.service.demoCheckout({ listingId, licenseType: 'rent', price: 1, priceCents: 1,
  buyerId: otherId, sellerId: userId, expiresAt: '2999-01-01T00:00:00Z' })
assert.equal(result.licenseId, licenseId)
assert.deepEqual(test.events.find(([event]) => event === 'rpc')[2], { p_listing_id: listingId, p_license_type: 'rent' }, 'caller prices, parties and expiry never enter the RPC')

for (const invalid of [undefined, {}, { listingId: '../private', licenseType: 'buy' }, { listingId, licenseType: 'BUY' }, { listingId, licenseType: 'premium' }]) {
  test = await setup()
  assert.equal((await test.service.demoCheckout(invalid)).error.code, 'invalid_checkout')
  assert.equal(test.events.length, 0)
}
for (const [state, code] of [[{ noClient: true }, 'configuration'], [{ signedOut: true }, 'authentication_required'],
  [{ authError: { code: 'invalid_jwt' } }, 'authentication_required'], [{ authThrows: true }, 'authentication_error']]) {
  test = await setup(state)
  assert.equal((await test.service.demoCheckout({ listingId, licenseType: 'buy' })).error.code, code)
  assert.equal(test.events.some(([event]) => event === 'rpc' || event === 'from'), false)
}
for (const [error, code] of [[{ code: '42501' }, 'access_denied'], [{ status: 401 }, 'access_denied'],
  [{ code: 'P0002' }, 'listing_unavailable'], [{ code: '22023' }, 'offer_unavailable'],
  [{ code: '23514' }, 'offer_unavailable'], [{ code: '23505' }, 'duplicate_purchase'],
  [{ code: 'PGRST202' }, 'setup_required'], [{ code: '42883' }, 'setup_required'],
  [{ code: '40001' }, 'license_error'], [{ code: '40P01' }, 'license_error'], [{ code: '23503' }, 'license_error']]) {
  test = await setup({ rpcError: error })
  result = await test.service.demoCheckout({ listingId, licenseType: 'buy' })
  assert.equal(result.error.code, code)
  assert.equal(result.error.outcomeUnknown, false)
  assert.equal(test.events.filter(([event]) => event === 'rpc').length, 1)
  assert.equal(test.events.some(([event, phase]) => event === 'matching' && phase === 'after'), false, 'definitive database rejection never becomes a success')
}

for (const state of [{ rpcThrows: true }, { rpcData: null }, { rpcData: 'invalid-uuid' }, { rpcError: { status: 503 } }]) {
  test = await setup(state)
  result = await test.service.demoCheckout({ listingId, licenseType: 'rent' })
  assert.equal(result.error.outcomeUnknown, true)
  assert.match(result.error.message, /My Library/)
  assert.equal(test.events.filter(([event]) => event === 'rpc').length, 1, 'never automatically repeat a mutation')
}

for (const license of [receipt, rental]) {
  test = await setup({ rpcThrows: true, after: [license] })
  result = await test.service.demoCheckout({ listingId, licenseType: license.license_type })
  assert.equal(result.licenseId, licenseId, 'new own receipt safely reconciles a lost response')
  assert.equal(result.error, null)
}
const expiredRental = { ...rental, id: oldId, created_at: '2025-01-01T00:00:00Z', expires_at: '2025-01-31T00:00:00Z' }
for (const after of [[expiredRental], [{ ...rental, buyer_id: otherId }], [{ ...rental, listing_id: otherId }], [{ ...receipt }]]) {
  test = await setup({ rpcThrows: true, before: [expiredRental], after })
  result = await test.service.demoCheckout({ listingId, licenseType: 'rent' })
  assert.equal(result.licenseId, null, 'old, expired, foreign and different-type receipts never confirm an ambiguous rental')
  assert.equal(result.error.outcomeUnknown, true)
}
test = await setup({ before: [rental] })
assert.equal((await test.service.demoCheckout({ listingId, licenseType: 'rent' })).licenseId, licenseId, 'server may return an existing active rental id')
test = await setup({ rpcThrows: true, before: [rental], after: [rental] })
assert.equal((await test.service.demoCheckout({ listingId, licenseType: 'rent' })).error.outcomeUnknown, true, 'an existing rental is never reauthorized by browser time')
test = await setup({ rpcThrows: true, afterThrows: true })
assert.equal((await test.service.demoCheckout({ listingId, licenseType: 'rent' })).error.outcomeUnknown, true)
test = await setup({ queryError: { code: '42501' } })
assert.ok((await test.service.demoCheckout({ listingId, licenseType: 'buy' })).error)
assert.equal(test.events.some(([event]) => event === 'rpc'), false, 'failed preflight does not issue a checkout')

test = await setup()
assert.equal((await test.service.getMyLicense(licenseId)).license.id, licenseId)
for (const detail of [null, { ...receipt, buyer_id: otherId }, { ...receipt, id: otherId }]) {
  test = await setup({ detail })
  assert.equal((await test.service.getMyLicense(licenseId)).error.code, 'access_denied')
}
test = await setup()
assert.equal((await test.service.getMyLicense('bad')).error.code, 'invalid_license')
assert.equal(test.events.length, 0)

test = await setup({ rows: [receipt, { ...receipt, id: oldId, listing: { id: listingId, status: 'archived', version: null } },
  { ...expiredRental, listing: null }, { ...receipt, id: otherId, buyer_id: otherId }] })
result = await test.service.listMyLicenses()
assert.equal(result.error, null)
assert.equal(result.licenses.length, 3, 'historical, archived and expired receipts remain visible; foreign receipts are removed')
assert.equal(result.licenses[1].listing.status, 'archived')
assert.equal(result.licenses[2].listing, null, 'missing joined metadata must not hide license history')
test = await setup({ rows: [] })
assert.deepEqual(plain((await test.service.listMyLicenses()).licenses), [])
test = await setup({ rows: Array.from({ length: 201 }, () => receipt) })
assert.equal((await test.service.listMyLicenses()).licenses.length, 201)
assert.deepEqual(test.events.filter(([event]) => event === 'range'), [['range', 0, 199], ['range', 200, 399]])
for (const state of [{ signedOut: true }, { queryError: { code: '42501' } }, { queryThrows: true }]) {
  test = await setup(state)
  assert.ok((await test.service.listMyLicenses()).error)
  assert.ok((await test.service.getMyLicense(licenseId)).error)
}

console.log('PASS Prompt 15 license service: buy/rent RPC, verified auth, server-only price/parties/expiry, rejection mapping, retry-safe reconciliation, own receipts, archived/expired history, pagination and failures (mocked local tests).')
