import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// A local DOM/media boundary only: every auth and Supabase dependency is replaced.
// These tests execute the real page controllers, cards, and filter helpers.
const listingId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const ownerId = '33333333-3333-4333-8333-333333333333'
const privateUrl = 'https://example.invalid/storage/v1/object/voice-files/secret.wav'
const title = '<img src=x onerror=alert(1)> Narration'
const listing = {
  listing_id: listingId, title, description: '<script>unsafe()</script>', category: 'Speech',
  seller_display_name: '<b>Creator</b>', seller_id: ownerId, effect_type: 'muffle',
  sale_price_cents: 1234, rental_price_cents: 250, rental_days: 30, currency: 'EUR',
  preview_path: `${ownerId}/${listingId}.wav`, created_at: '2026-11-23T12:00:00Z',
  duration_seconds: 15.5, storage_path: privateUrl, full_audio_url: privateUrl,
}
const secondListing = {
  ...listing, listing_id: secondId, title: 'Echo ambience', category: 'Ambient',
  effect_type: 'echo', sale_price_cents: null, rental_price_cents: 400,
  preview_path: `${ownerId}/${secondId}.wav`,
}

function descendants(element) {
  return [element, ...element.children.flatMap(descendants)]
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.hidden = false
    this.disabled = false
    this.paused = true
    this.pauseCount = 0
    this.value = ''
    this.dataset = {}
    this._text = ''
  }

  append(...elements) {
    this.children.push(...elements)
  }
  replaceChildren(...elements) {
    this._text = ''
    this.children = []
    this.append(...elements)
  }
  set textContent(text) {
    this._text = String(text)
    this.children = []
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('')
  }
  set innerHTML(value) { throw new Error(`Unsafe HTML insertion: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  addEventListener(event, handler) {
    const handlers = this.listeners.get(event) ?? []
    handlers.push(handler)
    this.listeners.set(event, handlers)
  }
  async dispatch(event) {
    const detail = { type: event, target: this, preventDefault() {} }
    await Promise.all((this.listeners.get(event) ?? []).map((handler) => handler(detail)))
  }
  querySelectorAll(selector) {
    assert.equal(selector, 'audio[data-marketplace-preview]')
    return descendants(this).filter((node) => node.tagName === 'audio' && node.attributes.has('data-marketplace-preview'))
  }
  pause() { this.paused = true; this.pauseCount++ }
  async play() { this.paused = false; await this.dispatch('play') }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function setup(page = 'marketplace', overrides = {}) {
  const htmlName = page === 'marketplace' ? 'marketplace.html' : 'voice-details.html'
  const html = await readFile(new URL(`../${htmlName}`, import.meta.url), 'utf8')
  const elements = new Map()
  const body = new Element('body')
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const id = /\bid="([^"]+)"/.exec(match[2])?.[1]
    if (!id) continue
    const element = new Element(match[1].toLowerCase())
    element.id = id
    element.hidden = /\bhidden\b/.test(match[2])
    element.disabled = /\bdisabled\b/.test(match[2])
    elements.set(`#${id}`, element)
    body.append(element)
  }
  if (page === 'marketplace') {
    elements.get('#license-filter').value = 'all'
    elements.get('#marketplace-filters').reset = () => {
      for (const id of ['market-search', 'category-filter', 'min-price-filter', 'max-price-filter']) elements.get(`#${id}`).value = ''
      elements.get('#license-filter').value = 'all'
    }
  }
  const calls = { list: 0, details: [], preview: [], reportForms: [] }
  const state = {
    user: { id: ownerId }, listResult: { listings: [listing, secondListing], error: null },
    detailResult: { listing, error: null }, ...overrides,
  }
  const document = {
    title: '', body,
    querySelector(selector) {
      assert.ok(elements.has(selector), `Missing HTML element ${selector}`)
      return elements.get(selector)
    },
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  }
  const windowListeners = new Map()
  const context = createContext({
    console, Intl, Date, URLSearchParams,
    document,
    window: {
      location: { search: overrides.search ?? `?id=${listingId}` },
      addEventListener(event, handler) { windowListeners.set(event, handler) },
    },
  })
  const stubs = {
    'bootstrap.bundle.min.js': {},
    'navbar.js': { renderNavbar() {} }, 'footer.js': { renderFooter() {} },
    'pageTransitions.js': { initPageTransitions() {} },
    'routeGuard.js': { requireAuthentication: async () => state.authPromise ? state.authPromise : state.user },
    'listingReport.js': {
      createListingReportForm(item, options) {
        calls.reportForms.push({ listingId: item.listing_id, userId: options.userId })
        const report = new Element('section')
        report.setAttribute('aria-label', 'Report listing')
        report.textContent = 'Report form'
        return report
      },
    },
    'licenseService.js': {
      async demoCheckout() { throw new Error('The marketplace browsing regression must never issue checkout') },
      async getMyLicense() { throw new Error('The marketplace browsing regression must never load a receipt') },
    },
    'marketplaceService.js': {
      async listMarketplaceListings() { calls.list++; return state.listPromise ? state.listPromise : state.listResult },
      async getMarketplaceListing(id) { calls.details.push(id); return state.detailPromise ? state.detailPromise : state.detailResult },
      getPublicPreviewUrl(path) {
        calls.preview.push(path)
        return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.wav$/i.test(path ?? '')
          ? `https://example.invalid/storage/v1/object/public/voice-previews/${path}` : null
      },
    },
  }
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const pending = (async () => {
      const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
      await module.link(async (specifier, parent) => {
        const name = specifier.split('/').at(-1)
        if (Object.hasOwn(stubs, name)) {
          const values = stubs[name]
          return new SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value)
          }, { context })
        }
        return load(new URL(specifier, parent.identifier))
      })
      return module
    })()
    cache.set(url.href, pending)
    return pending
  }
  const moduleName = page === 'marketplace' ? 'marketplacePage.js' : 'voiceDetailsPage.js'
  const module = await load(new URL(`../src/js/pages/${moduleName}`, import.meta.url))
  await module.evaluate()
  await settle()
  return { elements, state, calls, document, windowListeners, get: (id) => elements.get(`#${id}`) }
}

function audioNodes(ui, id) { return descendants(ui.get(id)).filter((node) => node.tagName === 'audio') }
function assertPublicOnly(ui, id) {
  for (const node of descendants(ui.get(id))) {
    assert.ok(!node.textContent.includes(privateUrl))
    for (const value of [node.src, node.href, ...node.attributes.values()].filter(Boolean)) {
      assert.ok(!String(value).includes('voice-files'), `Private file rendered: ${value}`)
    }
    if (node.tagName === 'audio') {
      assert.match(node.src, /\/public\/voice-previews\//)
      assert.equal(node.controls, true)
      assert.equal(node.preload, 'none')
    }
  }
}

// Auth must resolve before any catalogue request. A guest causes no data fetch.
const pendingAuth = deferred()
let ui = await setup('marketplace', { authPromise: pendingAuth.promise })
assert.equal(ui.calls.list, 0)
pendingAuth.resolve(null)
await settle()
assert.equal(ui.calls.list, 0)
ui = await setup('details', { user: null })
assert.equal(ui.calls.details.length, 0)

// Loading stays visible, controls disabled, and no cards exist before the request resolves.
const pendingList = deferred()
ui = await setup('marketplace', { listPromise: pendingList.promise })
assert.match(ui.get('marketplace-status').textContent, /Loading/)
assert.equal(ui.get('marketplace-filter-fields').disabled, true)
assert.equal(ui.get('marketplace-list').getAttribute('aria-busy'), 'true')
assert.equal(ui.get('marketplace-list').children.length, 0)
pendingList.resolve({ listings: [listing, secondListing], error: null })
await settle()
assert.equal(ui.get('marketplace-list').children.length, 2)
assert.equal(ui.get('marketplace-filter-fields').disabled, false)
assert.equal(ui.get('marketplace-list').getAttribute('aria-busy'), 'false')
let nodes = descendants(ui.get('marketplace-list'))
assert.ok(nodes.some((node) => node.tagName === 'h2' && node.textContent === title))
assert.ok(nodes.some((node) => node.textContent === `By ${listing.seller_display_name}`))
assert.ok(nodes.some((node) => node.textContent === 'Muffle'))
assert.ok(nodes.some((node) => node.href === `/voice-details.html?id=${listingId}`))
assertPublicOnly(ui, 'marketplace-list')
const players = audioNodes(ui, 'marketplace-list')
await players[0].play()
await players[1].play()
assert.equal(players[0].paused, true)
assert.equal(players[1].paused, false)
await players[1].dispatch('error')
assert.match(ui.get('marketplace-list').textContent, /public preview could not be played/)

// Search matches both title and category, filters combine, and clear restores the catalogue.
ui.get('market-search').value = 'ambient'
await ui.get('marketplace-filters').dispatch('submit')
assert.equal(ui.get('marketplace-list').children.length, 1)
assert.match(ui.get('marketplace-list').textContent, /Echo ambience/)
assert.ok(players.every((player) => player.paused))
ui.get('market-search').value = ''
ui.get('license-filter').value = 'buy'
ui.get('min-price-filter').value = '12.34'
ui.get('max-price-filter').value = '12.34'
await ui.get('marketplace-filters').dispatch('submit')
assert.equal(ui.get('marketplace-list').children.length, 1)
assert.match(ui.get('marketplace-list').textContent, /Narration/)
ui.get('min-price-filter').value = '20.00'
ui.get('max-price-filter').value = '1.00'
await ui.get('marketplace-filters').dispatch('submit')
assert.equal(ui.get('marketplace-filter-error').hidden, false)
assert.equal(ui.get('min-price-filter').getAttribute('aria-invalid'), 'true')
await ui.get('marketplace-clear').dispatch('click')
assert.equal(ui.get('marketplace-filter-error').hidden, true)
assert.equal(ui.get('marketplace-list').children.length, 2)
ui.get('market-search').value = 'no such voice'
await ui.get('marketplace-filters').dispatch('submit')
assert.equal(ui.get('marketplace-empty').hidden, false)
assert.match(ui.get('marketplace-empty-message').textContent, /match these filters/)

ui = await setup('marketplace', { listResult: { listings: [], error: null } })
assert.equal(ui.get('marketplace-empty').hidden, false)
assert.match(ui.get('marketplace-empty-message').textContent, /No published listings/)
ui = await setup('marketplace', { listResult: { listings: null, error: { code: 'network_error', message: 'Connection failed' } } })
assert.equal(ui.get('marketplace-error').hidden, false)
assert.equal(ui.get('marketplace-error-message').textContent, 'Connection failed')
assert.equal(ui.get('marketplace-retry').hidden, false)
ui.state.listResult = { listings: [listing], error: null }
await ui.get('marketplace-retry').dispatch('click')
assert.equal(ui.calls.list, 2)
assert.equal(ui.get('marketplace-error').hidden, true)
assert.equal(ui.get('marketplace-list').children.length, 1)
ui = await setup('marketplace', { listResult: { listings: null, error: { code: 'access_denied', message: 'Access denied' } } })
assert.equal(ui.get('marketplace-error').hidden, false)
assert.equal(ui.get('marketplace-retry').hidden, true)
assert.equal(ui.get('marketplace-list').children.length, 0)

// Legacy preview fixtures stay visible without a fallback to private audio.
ui = await setup('marketplace', { listResult: { listings: [{ ...listing, preview_path: 'preview-a.wav' }], error: null } })
assert.equal(ui.get('marketplace-list').children.length, 1)
assert.equal(audioNodes(ui, 'marketplace-list').length, 0)
assert.match(ui.get('marketplace-list').textContent, /public preview is unavailable/)
assertPublicOnly(ui, 'marketplace-list')

// Details render escaped metadata, prices, dates and terms; own offers stay disabled.
ui = await setup('details')
assert.deepEqual(ui.calls.details, [listingId])
assert.equal(ui.get('details-title').textContent, title)
assert.equal(ui.get('details-content').hidden, false)
nodes = descendants(ui.get('details-content'))
assert.ok(nodes.some((node) => node.textContent === listing.description))
assert.ok(nodes.some((node) => node.textContent === listing.seller_display_name))
assert.ok(nodes.some((node) => node.textContent === '15.5 seconds'))
assert.match(ui.get('details-content').textContent, /perpetual, nonexclusive/)
assert.match(ui.get('details-content').textContent, /license for 30 days/)
assert.match(ui.get('details-content').textContent, /No real money will be charged/)
const buttons = nodes.filter((node) => node.tagName === 'button')
const ownOffers = buttons.filter((button) => ['Demo Buy', 'Demo Rent · 30 days'].includes(button.textContent))
assert.equal(ownOffers.length, 2)
assert.ok(ownOffers.every((button) => button.disabled))
assert.deepEqual(ui.calls.reportForms, [{ listingId, userId: ownerId }], 'details passes only the current session identity and listing to the report component')
assert.ok(nodes.some((node) => node.getAttribute('aria-label') === 'Report listing'))
assert.match(ui.get('details-content').textContent, /cannot buy or rent your own/)
assertPublicOnly(ui, 'details-content')
ui.windowListeners.get('pagehide')()
assert.ok(audioNodes(ui, 'details-content').every((player) => player.paused))

const pendingDetail = deferred()
ui = await setup('details', { detailPromise: pendingDetail.promise })
assert.equal(ui.get('details-content').hidden, true)
assert.match(ui.get('details-status').textContent, /Loading/)
pendingDetail.resolve({ listing, error: null })
await settle()
assert.equal(ui.get('details-content').hidden, false)
for (const [search, code] of [['', 'invalid_listing'], ['?id=invalid', 'invalid_listing'], [`?id=${secondId}`, 'not_found']]) {
  ui = await setup('details', { search, detailResult: { listing: null, error: { code, message: 'Listing unavailable' } } })
  assert.equal(ui.get('details-content').hidden, true)
  assert.equal(ui.get('details-error').hidden, false)
  assert.equal(ui.get('details-retry').hidden, true)
  assert.equal(ui.get('details-content').children.length, 0)
}
ui = await setup('details', { detailResult: { listing: null, error: { code: 'network_error', message: 'Connection failed' } } })
assert.equal(ui.get('details-retry').hidden, false)
ui.state.detailResult = { listing, error: null }
await ui.get('details-retry').dispatch('click')
assert.equal(ui.calls.details.length, 2)
assert.equal(ui.get('details-content').hidden, false)
assert.equal(ui.get('details-error').hidden, true)

console.log('Marketplace UI tests passed (auth, loading, safe cards/details, filters/reset, empty/errors/retry, public previews, own-offer and moderation boundaries).')
