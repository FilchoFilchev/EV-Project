import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const licenseId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const privatePath = 'seller/private.webm?token=never-render-this'
const receipt = {
  id: licenseId, listing_id: otherId, license_type: 'buy', price_cents: 450,
  created_at: '2026-11-23T12:00:00Z', expires_at: null,
  listing: { status: 'archived', version: { recording: { title: '<img src=x> Voice' } } },
  storage_path: privatePath,
}
const success = { audio: { blob: new Blob(['audio'], { type: 'audio/webm' }), filename: 'Voice.webm', title: 'Voice', versionId: otherId }, error: null }
const descendants = (node) => [node, ...node.children.flatMap(descendants)]
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.hidden = false
    this.disabled = false
    this._text = ''
    this.paused = true
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node) } }
  replaceChildren(...nodes) { this.children = []; this._text = ''; this.append(...nodes) }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join('') }
  set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); delete this[name] }
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  removeEventListener(name) { this.listeners.delete(name) }
  async dispatch(name, event = {}) { return this.listeners.get(name)?.({ preventDefault() {}, ...event }) }
  click() { this.clicked = true }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this) }
  pause() { this.paused = true }
  load() { this.loadCount = (this.loadCount ?? 0) + 1 }
  async play() { if (this.rejectPlay) throw new Error('Playback requires gesture'); this.paused = false }
}

async function setup(overrides = {}) {
  const elements = new Map(['licenses-status', 'licenses-error', 'licenses-empty', 'licenses-list', 'licenses-refresh']
    .map((id) => [`#${id}`, new Element(id === 'licenses-refresh' ? 'button' : 'div')]))
  const state = {
    receipts: { licenses: [receipt], error: null }, audioResult: success,
    calls: [], createdUrls: [], revokedUrls: [], links: [], timers: new Map(), windowEvents: new Map(), ...overrides,
  }
  const body = new Element('body')
  const context = createContext({
    console, Date, Intl, Number, Blob,
    URL: {
      createObjectURL(blob) { assert.equal(blob, success.audio.blob); const url = `blob:local-${state.createdUrls.length}`; state.createdUrls.push(url); return url },
      revokeObjectURL(url) { state.revokedUrls.push(url) },
    },
    window: {
      setTimeout(callback, delay) { assert.equal(delay, 60_000); const id = Symbol('timer'); state.timers.set(id, callback); return id },
      clearTimeout(id) { state.timers.delete(id) },
      addEventListener(name, handler) { state.windowEvents.set(name, handler) },
      removeEventListener(name) { state.windowEvents.delete(name) },
    },
    document: {
      body,
      createElement(tag) { const node = new Element(tag); if (tag === 'a') state.links.push(node); return node },
      querySelector(id) { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id) },
    },
  })
  const cache = new Map()
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href)
    const pending = (async () => {
      const module = new SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href })
      await module.link(async (specifier, parent) => {
        if (specifier.endsWith('/licenseService.js')) return new SyntheticModule(['listMyLicenses'], function () {
          this.setExport('listMyLicenses', async () => state.pendingReceipts ?? state.receipts)
        }, { context })
        if (specifier.endsWith('/licensedAudioService.js')) return new SyntheticModule(['getLicensedAudio'], function () {
          this.setExport('getLicensedAudio', async (...args) => {
            state.calls.push(args)
            if (state.throwAudio) throw new Error(privatePath)
            return state.pendingAudio ?? state.audioResult
          })
        }, { context })
        if (specifier.endsWith('/authService.js')) return new SyntheticModule(['subscribeToAuthState'], function () {
          this.setExport('subscribeToAuthState', (callback) => {
            state.auth = callback
            callback({ user: { id: 'buyer' } })
            return () => { state.unsubscribed = true }
          })
        }, { context })
        return load(new URL(specifier, parent.identifier))
      })
      return module
    })()
    cache.set(url.href, pending)
    return pending
  }
  const module = await load(new URL('../src/js/components/acquiredLicenses.js', import.meta.url))
  await module.evaluate()
  const controller = module.namespace.initAcquiredLicenses()
  await controller.load()
  const nodes = () => descendants(elements.get('#licenses-list'))
  return {
    state, controller, nodes, body,
    play: () => nodes().find((node) => node.tagName === 'button' && node.textContent === 'Play full audio'),
    download: () => nodes().find((node) => node.tagName === 'button' && node.textContent === 'Download full audio'),
    player: () => nodes().find((node) => node.tagName === 'audio'),
    message: () => nodes().find((node) => node.getAttribute('role') === 'status'),
    get: (id) => elements.get(`#${id}`),
  }
}

let ui = await setup()
assert.equal(ui.state.calls.length, 0, 'receipts do not prefetch licensed audio')
assert.equal(ui.player().preload, 'none')
assert.equal(ui.player().hidden, true)
assert.ok(!ui.get('licenses-list').textContent.includes(privatePath))
await ui.play().dispatch('click')
assert.deepEqual(ui.state.calls, [[licenseId]], 'only receipt ID goes to service; no paths/claims')
assert.equal(ui.player().src, 'blob:local-0')
assert.equal(ui.player().controls, true)
assert.equal(ui.player().hidden, false)
assert.equal(ui.message().textContent, 'Playing Voice.')
assert.equal(ui.play().disabled, false)
await ui.download().dispatch('click')
assert.equal(ui.state.calls.length, 2, 'download freshly rechecks authorization after playback')
assert.ok(ui.state.revokedUrls.includes('blob:local-0'))
assert.equal(ui.player().hidden, true)
assert.equal(ui.state.links[0].href, 'blob:local-1')
assert.equal(ui.state.links[0].download, 'Voice.webm')
assert.equal(ui.state.links[0].clicked, true)
assert.equal(ui.body.children.length, 0, 'temporary anchor is removed')
assert.match(ui.message().textContent, /Download started/)
for (const callback of ui.state.timers.values()) callback()
assert.ok(ui.state.revokedUrls.includes('blob:local-1'))

const pending = deferred()
ui = await setup({ pendingAudio: pending.promise })
const playing = ui.play().dispatch('click')
await settle()
assert.equal(ui.play().disabled, true)
assert.equal(ui.download().disabled, true)
assert.match(ui.message().textContent, /Loading licensed/)
await ui.play().dispatch('click')
await ui.download().dispatch('click')
assert.equal(ui.state.calls.length, 1, 'rapid and simultaneous actions cannot duplicate requests')
pending.resolve(success)
await playing
assert.equal(ui.play().disabled, false)

for (const code of ['license_expired', 'access_denied', 'authentication_required', 'file_unavailable', 'download_failed', 'invalid_audio']) {
  ui = await setup({ audioResult: { audio: null, error: { code, message: `${code}: access unavailable` } } })
  await ui.download().dispatch('click')
  assert.match(ui.message().textContent, new RegExp(code))
  assert.equal(ui.state.createdUrls.length, 0)
  assert.equal(ui.state.links.length, 0)
  assert.equal(ui.download().disabled, false)
  ui.state.audioResult = success
  await ui.download().dispatch('click')
  assert.equal(ui.state.links.length, 1, 'failed requests can be retried after recovery')
}

ui = await setup({ throwAudio: true })
await ui.play().dispatch('click')
assert.match(ui.message().textContent, /Check your connection/)
assert.ok(!ui.message().textContent.includes(privatePath), 'raw service exceptions cannot expose paths/tokens')
assert.equal(ui.play().disabled, false)
ui.state.throwAudio = false
ui.player().rejectPlay = true
await ui.play().dispatch('click')
assert.match(ui.message().textContent, /Use the player controls/)
assert.equal(ui.player().hidden, false)
await ui.player().dispatch('error')
assert.equal(ui.player().hidden, true)
assert.match(ui.message().textContent, /Try downloading/)
assert.equal(ui.state.revokedUrls.length, 1)

for (const event of ['signout', 'account-change', 'refresh', 'pagehide', 'dispose']) {
  const delayed = deferred()
  ui = await setup({ pendingAudio: delayed.promise })
  const downloading = ui.download().dispatch('click')
  await settle()
  if (event === 'signout') ui.state.auth({ user: null })
  if (event === 'account-change') ui.state.auth({ user: { id: 'different-buyer' } })
  if (event === 'refresh') await ui.controller.load()
  if (event === 'pagehide') ui.state.windowEvents.get('pagehide')({ persisted: false })
  if (event === 'dispose') ui.controller.dispose()
  delayed.resolve(success)
  await downloading
  assert.equal(ui.state.createdUrls.length, 0, `${event} invalidates pending response`)
  assert.equal(ui.state.links.length, 0)
}

ui = await setup()
await ui.play().dispatch('click')
await ui.controller.load()
assert.ok(ui.state.revokedUrls.includes('blob:local-0'), 'refresh revokes playback')
await ui.download().dispatch('click')
ui.state.auth({ user: null })
assert.ok(ui.state.revokedUrls.includes('blob:local-1'), 'session end revokes download blobs')
assert.equal(ui.state.timers.size, 0)
assert.equal(ui.get('licenses-list').children.length, 0)
assert.match(ui.get('licenses-status').textContent, /session ended/)

ui = await setup()
await ui.play().dispatch('click')
ui.state.windowEvents.get('pagehide')({ persisted: true })
assert.ok(ui.state.revokedUrls.includes('blob:local-0'))
assert.equal(ui.get('licenses-list').children.length, 0)
ui.state.windowEvents.get('pageshow')({ persisted: true })
await settle()
assert.equal(ui.get('licenses-list').children.length, 1, 'back-forward restoration refreshes receipts')
ui.controller.dispose()
assert.equal(ui.state.unsubscribed, true)
assert.equal(ui.state.windowEvents.size, 0)
await ui.controller.load()
assert.equal(ui.get('licenses-list').children.length, 0)

console.log('Prompt 16 licensed audio UI tests passed (fresh authorization, playback/download, format, duplicate suppression, errors/recovery, expired/unauthorized states, safe text/blob URLs, stale-response cancellation, auth/page lifecycle cleanup).')
