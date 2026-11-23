import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Local service boundaries only. These mocks cannot access Supabase or Storage.
const userId = '11111111-1111-4111-8111-111111111111'
const listingId = '22222222-2222-4222-8222-222222222222'
const reportId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'
const report = { id: reportId, listing_id: listingId, reporter_id: userId,
  status: 'open', created_at: '2026-11-23T10:00:00Z', resolved_at: null }
const plain = (value) => JSON.parse(JSON.stringify(value))
const forbidden = () => { throw new Error('Unexpected direct write or private audio access') }

async function setup(name = 'reportService', overrides = {}) {
  const calls = []
  const state = { report: null, rows: [], rpcData: reportId, ...overrides }
  const client = {
    auth: { async getUser() {
      calls.push(['auth'])
      if (state.authThrows) throw new Error('offline')
      return { data: { user: state.signedOut ? null : { id: userId } }, error: state.authError }
    } },
    from(table) {
      calls.push(['from', table])
      assert.equal(table, 'reports')
      const filters = []
      return {
        select(fields) { calls.push(['select', fields]); assert.doesNotMatch(fields, /\*|reason|storage_path|email/); return this },
        eq(key, value) { filters.push([key, value]); return this },
        order(key, options) { calls.push(['order', key, plain(options)]); return this },
        limit(value) { assert.equal(value, 1); return this },
        async maybeSingle() {
          assert.deepEqual(filters, [['listing_id', listingId], ['reporter_id', userId]])
          if (state.queryThrows) throw new Error('offline')
          return { data: state.report, error: state.queryError }
        },
        insert: forbidden, update: forbidden, upsert: forbidden, delete: forbidden,
      }
    },
    async rpc(rpc, args) {
      calls.push(['rpc', rpc, plain(args)])
      if (state.rpcThrows) throw new Error('lost response')
      if (state.rpcError) return { data: null, error: state.rpcError }
      if (rpc.startsWith('admin_list_')) return { data: state.invalidRows ? null : state.rows.slice(args.p_offset, args.p_offset + args.p_limit), error: null }
      return { data: state.rpcData, error: null }
    },
    storage: { from: forbidden },
  }
  const context = createContext({ console })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link((specifier, parent) => {
      if (specifier.endsWith('/supabaseClient.js')) return new SyntheticModule(['supabase', 'configurationError'], function () {
        this.setExport('supabase', state.noClient ? null : client)
        this.setExport('configurationError', 'Missing configuration')
      }, { context })
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL(`../src/js/services/${name}.js`, import.meta.url))
  await module.evaluate()
  return { service: module.namespace, calls, state }
}

let test = await setup()
let result = await test.service.createListingReport(listingId, '  Rights concern\nPlease review.  ')
assert.equal(result.reportId, reportId)
assert.equal(result.error, null)
assert.deepEqual(test.calls, [['auth'], ['rpc', 'create_listing_report', { p_listing_id: listingId, p_reason: 'Rights concern\nPlease review.' }]])

// Match PostgreSQL char_length using Unicode code points, not JS UTF-16 length.
for (const text of ['x'.repeat(1000), '😀'.repeat(1000), '\u00a0Rights concern\uFEFF', 'Line\twith\r\nwhitespace']) {
  test = await setup()
  assert.equal((await test.service.createListingReport(listingId, text)).error, null)
}
for (const reason of [undefined, null, {}, '', ' \n\t\u00a0', 'x'.repeat(1001), '😀'.repeat(1001), 'bad\u0000text', 'bad\u007Ftext', 'bad\u0085text']) {
  test = await setup()
  assert.equal((await test.service.createListingReport(listingId, reason)).error.code, 'invalid_report')
  assert.equal(test.calls.length, 0, 'invalid report must not reach Auth or API')
}
for (const id of ['', '../other', null]) {
  test = await setup()
  assert.equal((await test.service.createListingReport(id, 'reason')).error.code, 'invalid_listing')
  assert.equal((await test.service.getMyListingReport(id)).error.code, 'invalid_listing')
  assert.equal(test.calls.length, 0)
}
for (const [state, code] of [[{ noClient: true }, 'configuration'], [{ signedOut: true }, 'authentication_required'],
  [{ authError: { code: 'invalid_jwt' } }, 'authentication_required'], [{ authThrows: true }, 'authentication_error']]) {
  for (const name of ['reportService', 'adminService']) {
    test = await setup(name, state)
    result = name === 'reportService' ? await test.service.createListingReport(listingId, 'reason') : await test.service.listAdminReports()
    assert.equal(result.error.code, code)
    assert.equal(test.calls.some(([call]) => call === 'rpc' || call === 'from'), false)
  }
}
for (const [error, code] of [[{ code: '23505' }, 'duplicate_report'], [{ code: '42501' }, 'access_denied'],
  [{ status: 401 }, 'access_denied'], [{ status: 403 }, 'access_denied'], [{ code: '22023' }, 'invalid_input'],
  [{ code: '23514' }, 'invalid_input'], [{ code: 'P0002' }, 'not_found'], [{ code: 'PGRST202' }, 'setup_required'],
  [{ code: '42883' }, 'setup_required'], [{ code: '42P01' }, 'setup_required'], [{ code: '40P01' }, 'moderation_error']]) {
  test = await setup('reportService', { rpcError: { ...error, message: 'sensitive backend detail' } })
  result = await test.service.createListingReport(listingId, 'reason')
  assert.equal(result.error.code, code)
  assert.equal(result.error.outcomeUnknown, false)
  assert.doesNotMatch(result.error.message, /sensitive backend/)
}
for (const overrides of [{ rpcThrows: true }, { rpcData: null }, { rpcData: 'invalid' }, { rpcError: { status: 503 } }]) {
  test = await setup('reportService', overrides)
  result = await test.service.createListingReport(listingId, 'reason')
  assert.equal(result.error.code, 'outcome_unknown')
  assert.equal(result.error.outcomeUnknown, true)
  assert.equal(test.calls.filter(([call]) => call === 'rpc').length, 1, 'never retry mutations automatically')
}
for (const row of [null, report, { ...report, status: 'resolved', resolved_at: '2026-11-23T11:00:00Z' }]) {
  test = await setup('reportService', { report: row })
  result = await test.service.getMyListingReport(listingId)
  assert.equal(result.error, null)
  assert.deepEqual(plain(result.report), row)
}
for (const row of [{ ...report, reporter_id: otherId }, { ...report, listing_id: otherId }, { ...report, id: 'bad' }, { ...report, status: 'hidden' }]) {
  test = await setup('reportService', { report: row })
  result = await test.service.getMyListingReport(listingId)
  assert.equal(result.report, null)
  assert.ok(result.error, 'foreign/malformed report never escapes service boundary')
}
for (const overrides of [{ queryThrows: true }, { queryError: { code: '42501' } }]) {
  test = await setup('reportService', overrides)
  assert.ok((await test.service.getMyListingReport(listingId)).error)
}

const actions = [
  ['adminResolveReport', [reportId], 'admin_resolve_report', { p_report_id: reportId }],
  ['adminModerateListing', [listingId, 'archived'], 'admin_moderate_listing', { p_listing_id: listingId, p_status: 'archived' }],
  ['adminModerateListing', [listingId, 'published'], 'admin_moderate_listing', { p_listing_id: listingId, p_status: 'published' }],
  ['adminSetPremium', [userId, 'premium'], 'admin_set_premium', { p_target_user: userId, p_plan: 'premium' }],
  ['adminSetPremium', [userId, 'free'], 'admin_set_premium', { p_target_user: userId, p_plan: 'free' }],
]
for (const [method, args, rpc, rpcArgs] of actions) {
  test = await setup('adminService')
  assert.equal((await test.service[method](...args)).error, null)
  assert.deepEqual(test.calls, [['auth'], ['rpc', rpc, rpcArgs]], 'admin mutations have narrowly scoped server parameters')
  // Simulates a server authorization refusal; actual SQL roles are tested in SQL.
  test = await setup('adminService', { rpcError: { code: '42501' } })
  assert.equal((await test.service[method](...args)).error.code, 'access_denied')
  test = await setup('adminService', { rpcThrows: true })
  assert.equal((await test.service[method](...args)).error.outcomeUnknown, true)
  assert.equal(test.calls.filter(([call]) => call === 'rpc').length, 1)
}
for (const [method, args] of [['adminResolveReport', ['bad']], ['adminModerateListing', [listingId, 'draft']],
  ['adminModerateListing', [listingId, 'deleted']], ['adminModerateListing', [listingId, null]],
  ['adminSetPremium', [userId, 'admin']], ['adminSetPremium', ['bad', 'premium']]]) {
  test = await setup('adminService')
  assert.equal((await test.service[method](...args)).error.code, 'invalid_input')
  assert.equal(test.calls.length, 0)
}
for (const [method, rpc, key] of [['listAdminUsers', 'admin_list_users', 'users'],
  ['listAdminListings', 'admin_list_listings', 'listings'], ['listAdminReports', 'admin_list_reports', 'reports']]) {
  test = await setup('adminService')
  assert.deepEqual(plain((await test.service[method]())[key]), [])
  const rows = Array.from({ length: 201 }, (_, i) => ({ id: i }))
  test = await setup('adminService', { rows })
  assert.deepEqual(plain((await test.service[method]())[key]), rows)
  assert.deepEqual(test.calls.filter(([call]) => call === 'rpc'), [
    ['rpc', rpc, { p_offset: 0, p_limit: 200 }], ['rpc', rpc, { p_offset: 200, p_limit: 200 }],
  ])
  for (const overrides of [{ rpcError: { code: '42501' } }, { rpcThrows: true }, { invalidRows: true }]) {
    test = await setup('adminService', overrides)
    result = await test.service[method]()
    assert.equal(result[key], null)
    assert.ok(result.error)
  }
}

console.log('PASS Prompt 17 services: report validation/duplicates, own-report privacy, authentication, scoped RPC parameters, admin refusals, archive/restore, Premium/free, pagination, errors and uncertain responses (mocked local tests).')
