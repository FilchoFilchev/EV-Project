import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Local boundaries only: these tests never connect to Auth, REST or Storage.
const userId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const recording = { id: otherId, owner_id: userId, title: '<img src=x onerror=alert(1)>', category: 'Speech', created_at: '2026-11-23T10:00:00Z' }
const plain = (value) => JSON.parse(JSON.stringify(value))

async function loadModule(file, context, replacements) {
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
    cache.set(url.href, module)
    await module.link((specifier, parent) => {
      const key = Object.keys(replacements).find((name) => specifier.endsWith(name))
      if (key) {
        const exports = replacements[key]
        return new SyntheticModule(Object.keys(exports), function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
        }, { context })
      }
      return load(new URL(specifier, parent.identifier))
    })
    return module
  }
  const module = await load(new URL(file, import.meta.url))
  await module.evaluate()
  return module.namespace
}

async function serviceSetup(overrides = {}) {
  const state = { rows: [recording], counts: [1201, 3, 2, 4], ...overrides }
  const calls = []
  let queryIndex = 0
  const client = {
    auth: { async getUser() {
      if (state.authThrows) throw Error('offline')
      return { data: { user: state.signedOut ? null : { id: userId } }, error: state.authError }
    } },
    from(table) {
      const index = queryIndex++
      const call = { table, filters: [], orders: [] }
      calls.push(call)
      return {
        select(fields, options) { call.fields = fields; call.options = options && plain(options); return this },
        eq(key, value) { call.filters.push(['eq', key, value]); return this },
        neq(key, value) { call.filters.push(['neq', key, value]); return this },
        not(key, operator, value) { call.filters.push(['not', key, operator, value]); return this },
        order(key, options) { call.orders.push([key, plain(options)]); return this },
        limit(value) { call.limit = value; return this },
        then(resolve, reject) {
          if (state.queryThrows) return Promise.reject(Error('network')).then(resolve, reject)
          return Promise.resolve({ data: index === 4 ? state.rows : null,
            count: index < 4 ? state.counts[index] : null,
            error: state.queryError && index === 2 ? { message: 'sensitive database detail' } : null }).then(resolve, reject)
        },
      }
    },
  }
  const service = await loadModule('../src/js/services/dashboardService.js', createContext({ Date }), {
    '/supabaseClient.js': { supabase: state.noClient ? null : client, configurationError: 'Missing browser config' },
  })
  return { state, calls, service }
}

let test = await serviceSetup()
let result = await test.service.getDashboardSummary()
assert.equal(result.error, null)
assert.deepEqual(plain(result.summary), {
  recordings: 1201, edited: 3, listings: 2, licenses: 4,
  recent: [{ id: recording.id, title: recording.title, category: recording.category, created_at: recording.created_at }],
})
assert.deepEqual(test.calls.map((call) => call.table), ['voice_recordings', 'voice_versions', 'listings', 'licenses', 'voice_recordings'])
assert.deepEqual(test.calls.map((call) => call.filters), [
  [['eq', 'owner_id', userId]],
  [['eq', 'recording.owner_id', userId], ['neq', 'effect_type', 'original']],
  [['eq', 'version.recording.owner_id', userId], ['eq', 'status', 'published'],
    ['eq', 'version.recording.visibility', 'public'], ['not', 'preview_path', 'is', null]],
  [['eq', 'buyer_id', userId]], [['eq', 'owner_id', userId]],
])
for (const call of test.calls.slice(0, 4)) assert.deepEqual(call.options, { count: 'exact', head: true })
assert.equal(test.calls[4].limit, 5)
assert.deepEqual(test.calls[4].orders, [['created_at', { ascending: false }], ['id', { ascending: false }]])
for (const call of test.calls) assert.doesNotMatch(call.fields, /storage_path|email|reason|\*/)

for (const [overrides, code] of [[{ noClient: true }, 'configuration'], [{ signedOut: true }, 'authentication_required'],
  [{ authError: {} }, 'authentication_required'], [{ authThrows: true }, 'dashboard_load_failed']]) {
  test = await serviceSetup(overrides)
  result = await test.service.getDashboardSummary()
  assert.equal(result.summary, null)
  assert.equal(result.error.code, code)
  assert.equal(test.calls.length, 0)
}
for (const overrides of [{ queryError: true }, { queryThrows: true }, { counts: [null, 0, 0, 0] },
  { counts: [-1, 0, 0, 0] }, { rows: null }, { rows: [{ ...recording, owner_id: otherId }] },
  { rows: [{ ...recording, created_at: 'not-a-date' }] }]) {
  test = await serviceSetup(overrides)
  result = await test.service.getDashboardSummary()
  assert.equal(result.summary, null)
  assert.equal(result.error.code, 'dashboard_load_failed')
  assert.doesNotMatch(result.error.message, /sensitive database detail/)
}
test = await serviceSetup({ rows: [], counts: [0, 0, 0, 0] })
assert.deepEqual(plain((await test.service.getDashboardSummary()).summary), { recordings: 0, edited: 0, listings: 0, licenses: 0, recent: [] })

class Element {
  constructor() { this.children = []; this._text = ''; this.hidden = false; this.disabled = false; this.attributes = new Map(); this.listeners = new Map() }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join('') }
  set innerHTML(value) { throw Error(`Unsafe HTML: ${value}`) }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this._text = ''; this.children = children }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  addEventListener(name, handler) { this.listeners.set(name, handler) }
}

const elements = new Map()
for (const name of ['overview', 'status', 'error', 'plan', 'recent', 'empty', 'refresh', 'recordings-count', 'edited-count', 'listings-count', 'licenses-count']) {
  elements.set(`#dashboard-${name}`, new Element())
}
let authHandler
let summaryResult = { summary: { recordings: 1, edited: 2, listings: 3, licenses: 4, recent: [recording] }, error: null }
let eligibilityResult = { premium: true, error: null }
let pending
let calls = 0
const events = new Map()
const context = createContext({
  document: { querySelector: (selector) => elements.get(selector), createElement: () => new Element() },
  window: { addEventListener: (name, handler) => events.set(name, handler), location: { reload() {} } },
  Intl, Date,
})
const component = await loadModule('../src/js/components/dashboardOverview.js', context, {
  '/dashboardService.js': { async getDashboardSummary() { calls++; if (pending) await pending; return summaryResult } },
  '/subscriptionService.js': { async getPremiumEligibility() { return eligibilityResult } },
  '/authService.js': { subscribeToAuthState(handler) { authHandler = handler; return () => {} } },
})
const ui = component.initDashboardOverview({ userId })
await ui.load()
assert.equal(elements.get('#dashboard-recordings-count').textContent, '1')
assert.equal(elements.get('#dashboard-plan').textContent, 'Current plan: Premium')
assert.equal(elements.get('#dashboard-recent').children[0].children[0].textContent, recording.title)
assert.equal(elements.get('#dashboard-empty').hidden, true)
assert.equal(elements.get('#dashboard-overview').attributes.get('aria-busy'), 'false')
assert.equal(elements.get('#dashboard-refresh').disabled, false)

summaryResult = { summary: { recordings: 0, edited: 0, listings: 0, licenses: 0, recent: [] }, error: null }
eligibilityResult = { premium: false, error: null }
await elements.get('#dashboard-refresh').listeners.get('click')()
assert.equal(elements.get('#dashboard-empty').hidden, false)
assert.equal(elements.get('#dashboard-plan').textContent, 'Current plan: Free')
summaryResult = { summary: null, error: { message: 'Please sign in again.' } }
eligibilityResult = { premium: false, error: 'not verified' }
await ui.load()
assert.equal(elements.get('#dashboard-error').hidden, false)
assert.equal(elements.get('#dashboard-error').textContent, 'Please sign in again.')
assert.equal(elements.get('#dashboard-recordings-count').textContent, '—')
assert.match(elements.get('#dashboard-plan').textContent, /could not be verified/)
assert.equal(elements.get('#dashboard-refresh').disabled, false)

summaryResult = { summary: { recordings: 99, edited: 2, listings: 3, licenses: 4, recent: [recording] }, error: null }
let resolve
pending = new Promise((done) => { resolve = done })
const loading = ui.load()
assert.equal(elements.get('#dashboard-refresh').disabled, true)
assert.equal(elements.get('#dashboard-overview').attributes.get('aria-busy'), 'true')
const previousCalls = calls
await ui.load()
assert.equal(calls, previousCalls, 'concurrent refresh is suppressed')
authHandler({ event: 'SIGNED_IN', user: { id: otherId } })
resolve()
await loading
assert.equal(elements.get('#dashboard-recent').children.length, 0, 'late responses cannot reveal a previous account')
assert.equal(elements.get('#dashboard-recordings-count').textContent, '—')
assert.equal(elements.get('#dashboard-refresh').disabled, true)
assert.match(elements.get('#dashboard-status').textContent, /account changed/)

const page = await readFile(new URL('../src/js/pages/dashboardPage.js', import.meta.url), 'utf8')
assert.match(page, /const user = await requireAuthentication\(\)/)
assert.match(page, /if \(user\) await initDashboardOverview/)
console.log('PASS Prompt 18 dashboard: authenticated owner-scoped exact counts, private field exclusion, empty/error/plan states, safe text rendering, retry, loading and account-change race protection (local mocks).')
