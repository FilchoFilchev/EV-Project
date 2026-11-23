import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Local DOM/service boundaries only. No Supabase, Storage, or network calls.
const listingId = '11111111-1111-4111-8111-111111111111'
const sellerId = '22222222-2222-4222-8222-222222222222'
const buyerId = '33333333-3333-4333-8333-333333333333'
const licenseId = '44444444-4444-4444-8444-444444444444'
const privateUrl = 'https://example.invalid/storage/v1/object/voice-files/private.wav'
const listing = {
  listing_id: listingId, seller_id: sellerId, title: '<img src=x onerror=alert(1)> Voice',
  sale_price_cents: 1234, rental_price_cents: 250, rental_days: 30, currency: 'EUR',
  storage_path: privateUrl, full_audio_url: privateUrl,
}
const receipt = {
  id: licenseId, listing_id: listingId, buyer_id: buyerId, license_type: 'buy',
  price_cents: 777, created_at: '2026-11-23T12:00:00Z', expires_at: null,
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
    this.checked = false
    this.value = ''
    this.dataset = {}
    this.valid = true
    this._text = ''
    this.classList = { add() {}, remove() {}, toggle() {} }
  }
  append(...nodes) {
    this.children.push(...nodes.map((node) => typeof node === 'string' ? Object.assign(new Element('text'), { textContent: node }) : node))
  }
  replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes) }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join('') }
  set innerHTML(value) { throw new Error(`Unsafe HTML insertion: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  addEventListener(name, handler) {
    const handlers = this.listeners.get(name) ?? []
    handlers.push(handler)
    this.listeners.set(name, handlers)
  }
  async dispatch(name) {
    await Promise.all((this.listeners.get(name) ?? []).map((handler) => handler({ type: name, target: this, preventDefault() {} })))
  }
  focus() { this.focused = true }
  reportValidity() { return this.valid }
  checkValidity() { return this.valid }
  reset() { for (const node of descendants(this)) if (node.tagName === 'input') node.checked = false }
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

async function setup(overrides = {}) {
  const calls = { checkout: [], receipt: [] }
  const state = {
    checkout: { licenseId, error: null }, receipt: { license: receipt, error: null },
    ...overrides,
  }
  const context = createContext({ console, Intl, Date, Number, document: { createElement: (tag) => new Element(tag) } })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const pending = (async () => {
      const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
      await module.link(async (specifier, parent) => {
        if (specifier.endsWith('/licenseService.js')) {
          const values = {
            async demoCheckout(input) { calls.checkout.push(input); if (state.throws) throw new Error('Connection lost'); return state.checkoutPromise ?? state.checkout },
            async getMyLicense(id) { calls.receipt.push(id); if (state.receiptThrows) throw new Error('Receipt transport failed'); return state.receiptPromise ?? state.receipt },
          }
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
  const module = await load(new URL('../src/js/components/demoCheckout.js', import.meta.url))
  await module.evaluate()
  const root = module.namespace.createDemoCheckout({ ...listing, ...state.listing }, { userId: Object.hasOwn(state, 'userId') ? state.userId : buyerId })
  const find = (predicate) => descendants(root).find(predicate)
  const button = (label) => find((node) => node.tagName === 'button' && node.textContent === label)
  const form = () => find((node) => node.tagName === 'form')
  const checkbox = () => find((node) => node.tagName === 'input' && node.type === 'checkbox')
  return { root, state, calls, button, form, checkbox, find }
}
async function confirm(ui, type = 'buy') {
  await ui.button(type === 'buy' ? 'Demo Buy' : 'Demo Rent · 30 days').dispatch('click')
  ui.checkbox().checked = true
  await ui.checkbox().dispatch('change')
  await ui.form().dispatch('submit')
  await settle()
}
function assertNoPrivateAudio(ui) {
  for (const node of descendants(ui.root)) {
    assert.ok(!node.textContent.includes(privateUrl), 'private audio must never render')
    for (const value of [node.src, node.href, ...node.attributes.values()].filter(Boolean)) assert.ok(!String(value).includes('voice-files'))
    assert.ok(!['iframe', 'script'].includes(node.tagName), 'untrusted values must not become executable markup')
  }
}

let ui = await setup()
assert.equal(ui.calls.checkout.length, 0)
await ui.button('Demo Buy').dispatch('click')
assert.equal(ui.calls.checkout.length, 0, 'opening confirmation must not checkout')
assert.match(ui.root.textContent, /No real money will be charged/)
assert.equal(ui.checkbox().checked, false)
assert.equal(ui.checkbox().required, true)
await ui.form().dispatch('submit')
assert.equal(ui.calls.checkout.length, 0, 'unchecked demo confirmation blocks a forged submit')
await ui.button('Cancel').dispatch('click')
assert.equal(ui.calls.checkout.length, 0)
assert.equal(ui.form().hidden, true)
await confirm(ui)
assert.equal(ui.calls.checkout.length, 1)
assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.checkout[0])), { listingId, licenseType: 'buy' })
assert.deepEqual(ui.calls.receipt, [licenseId])
assert.match(ui.root.textContent, new RegExp(licenseId))
assert.match(ui.root.textContent, /7\.77/, 'receipt must show trusted persisted snapshot, not the displayed offer')
assert.ok(ui.find((node) => node.tagName === 'a' && node.href === '/my-library.html#acquired-licenses'))
assertNoPrivateAudio(ui)

ui = await setup({ receipt: { license: { ...receipt, license_type: 'rent', expires_at: '2026-12-23T12:00:00Z' }, error: null } })
await confirm(ui, 'rent')
assert.equal(ui.calls.checkout[0].licenseType, 'rent')
assert.match(ui.root.textContent, /30|Dec|December|2026/)
assertNoPrivateAudio(ui)

ui = await setup({ userId: sellerId })
assert.ok(ui.button('Demo Buy').disabled)
assert.ok(ui.button('Demo Rent · 30 days').disabled)
await ui.button('Demo Buy').dispatch('click')
await ui.form().dispatch('submit')
assert.equal(ui.calls.checkout.length, 0, 'self-owned listings block even synthetic events')
assert.match(ui.root.textContent, /own|seller/i)

ui = await setup({ listing: { sale_price_cents: null } })
assert.equal(ui.button('Demo Buy'), undefined)
assert.ok(ui.button('Demo Rent · 30 days'))

const pending = deferred()
ui = await setup({ checkoutPromise: pending.promise })
await ui.button('Demo Buy').dispatch('click')
ui.checkbox().checked = true
await ui.checkbox().dispatch('change')
const inFlight = ui.form().dispatch('submit')
await settle()
assert.equal(ui.calls.checkout.length, 1)
assert.equal(ui.button('Confirm Demo Checkout').disabled, true)
assert.equal(ui.button('Demo Rent · 30 days').disabled, true)
await ui.form().dispatch('submit')
await ui.button('Demo Rent · 30 days').dispatch('click')
await ui.button('Cancel').dispatch('click')
assert.equal(ui.calls.checkout.length, 1, 'in-flight operation suppresses duplicate submits and offer switches')
pending.resolve({ licenseId, error: null })
await inFlight
assertNoPrivateAudio(ui)

for (const code of ['authentication_required', 'access_denied', 'own_listing', 'listing_unavailable', 'offer_unavailable', 'invalid_checkout', 'setup_required', 'duplicate_purchase']) {
  ui = await setup({ checkout: { licenseId: null, error: { code, message: `<script>${code}</script>` } } })
  await confirm(ui)
  assert.match(ui.root.textContent, new RegExp(code))
  assert.equal(ui.button('Demo Buy').disabled, true, `${code} blocks further checkout`)
  assert.equal(ui.button('Demo Rent · 30 days').disabled, true, `${code} blocks further checkout`)
  assert.equal(ui.calls.receipt.length, 0)
  assertNoPrivateAudio(ui)
}

ui = await setup({ checkout: { licenseId: null, error: { code: 'network_error', message: 'Check My Library before retrying.', outcomeUnknown: true } } })
await confirm(ui)
assert.match(ui.root.textContent, /My Library.*retry/i)
assert.equal(ui.calls.checkout.length, 1)
assert.equal(ui.calls.receipt.length, 0)
assertNoPrivateAudio(ui)

ui = await setup({ userId: null })
assert.equal(ui.button('Demo Buy').disabled, true)
await ui.button('Demo Buy').dispatch('click')
await ui.form().dispatch('submit')
assert.equal(ui.calls.checkout.length, 0)
assert.match(ui.root.textContent, /Sign in/)

ui = await setup({ listing: { sale_price_cents: null, rental_price_cents: null } })
assert.equal(ui.button('Demo Buy'), undefined)
assert.equal(ui.button('Demo Rent · 30 days'), undefined)
assert.match(ui.root.textContent, /no available demo offers/i)

ui = await setup({ checkout: { licenseId: null, error: { code: 'transaction_conflict', message: 'The transaction could not complete. Try again.' } } })
await confirm(ui)
assert.equal(ui.calls.checkout.length, 1)
assert.equal(ui.button('Demo Buy').disabled, false)
ui.state.checkout = { licenseId, error: null }
await confirm(ui)
assert.equal(ui.calls.checkout.length, 2, 'definite transaction failure can be manually retried after confirming again')
assert.match(ui.root.textContent, /successful/i)

ui = await setup({ throws: true })
await confirm(ui)
assert.match(ui.root.textContent, /My Library before trying again/)
assert.equal(ui.button('Demo Buy').disabled, true)
assert.equal(ui.calls.checkout.length, 1, 'unexpected failures cannot automatically retry an ambiguous operation')

ui = await setup({ receipt: { license: null, error: { code: 'network_error', message: 'Receipt unavailable' } } })
await confirm(ui)
assert.match(ui.root.textContent, new RegExp(licenseId))
assert.ok(ui.find((node) => node.tagName === 'a' && node.href === '/my-library.html#acquired-licenses'))
assert.equal(ui.calls.checkout.length, 1, 'receipt read failure never repeats checkout')

ui = await setup({ receiptThrows: true })
await confirm(ui)
assert.match(ui.root.textContent, /successful/)
assert.match(ui.root.textContent, new RegExp(licenseId), 'unexpected receipt failure preserves the known successful license ID')
assert.equal(ui.calls.checkout.length, 1)
assert.equal(ui.button('Demo Buy').disabled, true)

console.log('Demo Checkout UI tests passed (confirmation, purchase/rental receipts, loading, duplicate suppression, authorization, errors, safe text, and private audio exclusion).')
