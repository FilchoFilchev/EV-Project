import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Render persisted license receipts only. All service calls are local stubs.
const buyId = '11111111-1111-4111-8111-111111111111'
const rentId = '22222222-2222-4222-8222-222222222222'
const privateUrl = 'https://example.invalid/storage/v1/object/voice-files/private.wav'
const title = '<img src=x onerror=alert(1)> Licensed voice'
const buy = {
  id: buyId, listing_id: buyId, license_type: 'buy', price_cents: 1234,
  created_at: '2026-11-23T12:00:00Z', expires_at: null,
  listing: { status: 'archived', version: { recording: { title } } },
  storage_path: privateUrl, full_audio_url: privateUrl,
}
const expiredRental = {
  ...buy, id: rentId, listing_id: rentId, license_type: 'rent', price_cents: 250,
  created_at: '2026-01-01T12:00:00Z', expires_at: '2026-01-31T12:00:00Z', listing: null,
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)]
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.hidden = false
    this.disabled = false
    this._text = ''
  }
  append(...elements) { this.children.push(...elements) }
  replaceChildren(...elements) { this._text = ''; this.children = []; this.append(...elements) }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join('') }
  set innerHTML(value) { throw new Error(`Unsafe HTML insertion: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  addEventListener(name, handler) { this.listeners.set(name, handler) }
  async dispatch(name) { await this.listeners.get(name)?.({ preventDefault() {} }) }
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function setup(overrides = {}) {
  const elements = new Map(['licenses-status', 'licenses-error', 'licenses-empty', 'licenses-list', 'licenses-refresh']
    .map((id) => [`#${id}`, new Element(id === 'licenses-refresh' ? 'button' : 'div')]))
  const state = { result: { licenses: [buy, expiredRental], error: null }, calls: 0, ...overrides }
  const context = createContext({
    console, Date, Intl, Number,
    document: {
      createElement: (tag) => new Element(tag),
      querySelector: (id) => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id) },
    },
  })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const pending = (async () => {
      const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
      await module.link(async (specifier, parent) => {
        if (specifier.endsWith('/licenseService.js')) {
          return new SyntheticModule(['listMyLicenses'], function () {
            this.setExport('listMyLicenses', async () => { state.calls++; if (state.throws) throw new Error('Connection failed'); return state.pending ?? state.result })
          }, { context })
        }
        return load(new URL(specifier, parent.identifier))
      })
      return module
    })()
    cache.set(url.href, pending)
    return pending
  }
  const module = await load(new URL('../src/js/components/acquiredLicenses.js', import.meta.url))
  await module.evaluate()
  return { controller: module.namespace.initAcquiredLicenses(), state, elements, get: (id) => elements.get(`#${id}`) }
}

let ui = await setup()
assert.equal(ui.state.calls, 0)
await ui.controller.load()
assert.equal(ui.state.calls, 1)
assert.equal(ui.get('licenses-list').children.length, 2)
assert.equal(ui.get('licenses-status').textContent, '2 acquired licenses.')
assert.equal(ui.get('licenses-empty').hidden, true)
assert.equal(ui.get('licenses-error').hidden, true)
const nodes = descendants(ui.get('licenses-list'))
assert.ok(nodes.some((node) => node.tagName === 'h2' && node.textContent === title))
assert.match(ui.get('licenses-list').textContent, /perpetual nonexclusive license/)
assert.match(ui.get('licenses-list').textContent, /12\.34/)
assert.match(ui.get('licenses-list').textContent, /2\.50/)
assert.match(ui.get('licenses-list').textContent, /No expiry/)
assert.match(ui.get('licenses-list').textContent, /Listing archived.*license is preserved/)
assert.match(ui.get('licenses-list').textContent, /Licensed voice recording/)
assert.match(ui.get('licenses-list').textContent, /Rental validity is checked using database time/)
assert.match(ui.get('licenses-list').textContent, new RegExp(buyId))
assert.match(ui.get('licenses-list').textContent, new RegExp(rentId))
assert.ok(!ui.get('licenses-list').textContent.includes(privateUrl))
assert.ok(!nodes.some((node) => ['audio', 'a', 'button', 'script', 'img'].includes(node.tagName)), 'Prompt 15 does not introduce licensed download controls or untrusted HTML')

const pending = deferred()
ui = await setup({ pending: pending.promise })
const loading = ui.controller.load()
await settle()
assert.match(ui.get('licenses-status').textContent, /Loading/)
assert.equal(ui.get('licenses-refresh').disabled, true)
assert.equal(ui.get('licenses-list').getAttribute('aria-busy'), 'true')
assert.equal(ui.get('licenses-list').children.length, 0)
await ui.controller.load()
assert.equal(ui.state.calls, 1, 'pending receipt refresh cannot issue duplicate requests')
pending.resolve({ licenses: [buy], error: null })
await loading
assert.equal(ui.get('licenses-refresh').disabled, false)
assert.equal(ui.get('licenses-list').getAttribute('aria-busy'), 'false')
assert.equal(ui.get('licenses-status').textContent, '1 acquired license.')

ui = await setup({ result: { licenses: [], error: null } })
await ui.controller.load()
assert.equal(ui.get('licenses-empty').hidden, false)
assert.equal(ui.get('licenses-list').children.length, 0)

for (const code of ['authentication_required', 'access_denied', 'network_error']) {
  ui = await setup({ result: { licenses: null, error: { code, message: `<script>${code}</script>` } } })
  await ui.controller.load()
  assert.equal(ui.get('licenses-error').hidden, false)
  assert.equal(ui.get('licenses-error').textContent, `<script>${code}</script>`)
  assert.equal(ui.get('licenses-list').children.length, 0)
  assert.equal(ui.get('licenses-empty').hidden, true)
  assert.equal(ui.get('licenses-refresh').disabled, false)
  ui.state.result = { licenses: [buy], error: null }
  await ui.get('licenses-refresh').dispatch('click')
  assert.equal(ui.state.calls, 2)
  assert.equal(ui.get('licenses-error').hidden, true)
  assert.equal(ui.get('licenses-list').children.length, 1)
}

ui = await setup({ throws: true })
await ui.controller.load()
assert.equal(ui.get('licenses-error').hidden, false)
assert.match(ui.get('licenses-error').textContent, /could not be loaded/)
assert.equal(ui.get('licenses-refresh').disabled, false)
assert.equal(ui.get('licenses-list').getAttribute('aria-busy'), 'false')

console.log('Acquired licenses UI tests passed (persisted prices/expiry, archive preservation, safe text, fallback titles, loading, empty/error/refresh, and no licensed downloads).')
