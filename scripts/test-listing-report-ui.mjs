import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// Local DOM and mocked service boundaries only; no database or browser execution.
const listingId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const reportId = '33333333-3333-4333-8333-333333333333'
const sensitive = 'reporter@example.invalid/private/voice-files.wav'
const descendants = (node) => [node, ...node.children.flatMap(descendants)]
const settle = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.attributes = new Map()
    this.hidden = false
    this.disabled = false
    this.value = ''
    this._text = ''
  }
  append(...nodes) { this.children.push(...nodes) }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join('') }
  set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  addEventListener(name, handler) { this.listeners.set(name, handler) }
  async dispatch(name) { return this.listeners.get(name)?.({ preventDefault() {} }) }
  focus() { this.focused = true }
}

async function setup(overrides = {}) {
  const state = { existing: { report: null, error: null }, result: { reportId, error: null }, calls: [], reads: [], ...overrides }
  const context = createContext({ document: { createElement: (tag) => new Element(tag) } })
  const module = new SourceTextModule(await readFile(new URL('../src/js/components/listingReport.js', import.meta.url), 'utf8'), { context })
  await module.link(async (specifier) => {
    assert.ok(specifier.endsWith('/reportService.js'))
    return new SyntheticModule(['createListingReport', 'getMyListingReport'], function () {
      this.setExport('createListingReport', async (...args) => {
        state.calls.push(args)
        if (state.throwCreate) throw new Error(sensitive)
        return state.pendingCreate ?? state.result
      })
      this.setExport('getMyListingReport', async (...args) => {
        state.reads.push(args)
        if (state.throwRead) throw new Error(sensitive)
        return state.pendingRead ?? state.existing
      })
    }, { context })
  })
  await module.evaluate()
  const root = module.namespace.createListingReportForm({ listing_id: listingId, seller_id: userId, full_audio_url: sensitive }, { userId: Object.hasOwn(state, 'userId') ? state.userId : userId })
  const find = (predicate) => descendants(root).find(predicate)
  return {
    root, state, find,
    toggle: () => find((node) => node.tagName === 'button' && node.textContent === 'Report'),
    submit: () => find((node) => node.tagName === 'button' && node.textContent === 'Submit report'),
    cancel: () => find((node) => node.tagName === 'button' && node.textContent === 'Cancel'),
    form: () => find((node) => node.tagName === 'form'),
    reason: () => find((node) => node.tagName === 'textarea'),
    error: () => find((node) => node.getAttribute('role') === 'alert'),
    status: () => find((node) => node.getAttribute('role') === 'status'),
  }
}
async function open(ui) {
  await settle()
  await ui.toggle().dispatch('click')
}
function safe(ui) {
  assert.ok(!ui.root.textContent.includes(sensitive), 'reporter identity and private audio never render')
  for (const node of descendants(ui.root)) assert.ok(!['script', 'img', 'audio', 'iframe'].includes(node.tagName))
}

let ui = await setup()
assert.equal(ui.toggle().disabled, true)
assert.match(ui.status().textContent, /Checking/)
await ui.form().dispatch('submit')
assert.equal(ui.state.calls.length, 0, 'checking existing reports blocks synthetic submits')
await open(ui)
assert.equal(ui.form().hidden, false)
assert.equal(ui.toggle().getAttribute('aria-expanded'), 'true')
assert.equal(ui.reason().focused, true)
assert.equal(ui.reason().required, true)
assert.equal(ui.reason().maxLength, 1000)
assert.equal(ui.find((node) => node.tagName === 'label').htmlFor, ui.reason().id)
assert.equal(ui.status().getAttribute('aria-live'), 'polite')
assert.deepEqual(ui.state.reads, [[listingId]])
await ui.cancel().dispatch('click')
assert.equal(ui.form().hidden, true)
assert.equal(ui.toggle().focused, true)
await ui.form().dispatch('submit')
assert.equal(ui.state.calls.length, 0)
await ui.toggle().dispatch('click')
for (const value of ['', '  \n  ', 'a'.repeat(1001)]) {
  ui.reason().value = value
  await ui.form().dispatch('submit')
  assert.equal(ui.state.calls.length, 0)
  assert.match(ui.error().textContent, /1,000/)
}
ui.reason().value = '  I have a rights concern.  '
await ui.form().dispatch('submit')
assert.deepEqual(ui.state.calls, [[listingId, 'I have a rights concern.']])
assert.match(ui.status().textContent, /Report submitted/)
assert.equal(ui.toggle().disabled, true)
assert.equal(ui.reason().value, '')
assert.equal(ui.form().hidden, true)
await ui.form().dispatch('submit')
assert.equal(ui.state.calls.length, 1)
safe(ui)

for (const status of ['open', 'resolved']) {
  ui = await setup({ existing: { report: { id: reportId, status, reporter_id: sensitive, reason: '<script>never rendered</script>' }, error: null } })
  await settle()
  assert.match(ui.status().textContent, status === 'resolved' ? /resolved/ : /awaiting review/)
  assert.equal(ui.toggle().disabled, true)
  await ui.toggle().dispatch('click')
  assert.equal(ui.form().hidden, true)
  assert.equal(ui.state.calls.length, 0)
  safe(ui)
}

const pending = deferred()
ui = await setup({ pendingCreate: pending.promise })
await open(ui)
ui.reason().value = '<img src=x onerror=alert(1)> Concern'
const sending = ui.form().dispatch('submit')
await settle()
assert.equal(ui.submit().disabled, true)
assert.equal(ui.cancel().disabled, true)
assert.equal(ui.reason().disabled, true)
assert.equal(ui.root.getAttribute('aria-busy'), 'true')
assert.match(ui.status().textContent, /Submitting/)
await ui.form().dispatch('submit')
await ui.cancel().dispatch('click')
assert.equal(ui.state.calls.length, 1)
pending.resolve({ reportId, error: null })
await sending
assert.equal(ui.root.getAttribute('aria-busy'), 'false')
safe(ui)

ui = await setup({ result: { reportId: null, error: { code: 'duplicate_report', message: 'duplicate' } } })
await open(ui)
ui.reason().value = 'Duplicate report'
await ui.form().dispatch('submit')
assert.match(ui.status().textContent, /already reported/)
assert.equal(ui.toggle().disabled, true)
assert.equal(ui.form().hidden, true)

for (const code of ['authentication_required', 'access_denied', 'listing_unavailable', 'not_found', 'invalid_listing', 'setup_required']) {
  ui = await setup({ result: { reportId: null, error: { code, message: `<script>${code}</script>` } } })
  await open(ui)
  ui.reason().value = 'Concern'
  await ui.form().dispatch('submit')
  assert.match(ui.error().textContent, new RegExp(code))
  assert.equal(ui.error().hidden, false)
  assert.equal(ui.toggle().disabled, true)
  safe(ui)
}

ui = await setup({ result: { reportId: null, error: { code: 'network_error', message: 'Please check your connection.' } } })
await open(ui)
ui.reason().value = 'Concern'
await ui.form().dispatch('submit')
assert.equal(ui.submit().disabled, false)
assert.equal(ui.reason().value, 'Concern')
ui.state.result = { reportId, error: null }
await ui.form().dispatch('submit')
assert.equal(ui.state.calls.length, 2, 'transient errors allow an intentional retry')
assert.match(ui.status().textContent, /submitted/)

ui = await setup({ throwRead: true, throwCreate: true })
await open(ui)
assert.match(ui.error().textContent, /Unable to check/)
ui.reason().value = 'Concern'
await ui.form().dispatch('submit')
assert.match(ui.error().textContent, /could not confirm/)
safe(ui)

ui = await setup({ existing: { report: null, error: { code: 'access_denied', message: 'Forbidden' } } })
await settle()
assert.equal(ui.toggle().disabled, true)
assert.match(ui.error().textContent, /Forbidden/)

ui = await setup({ userId: null })
assert.equal(ui.toggle().disabled, true)
assert.match(ui.status().textContent, /Sign in/)
await ui.toggle().dispatch('click')
await ui.form().dispatch('submit')
assert.equal(ui.state.calls.length, 0)
assert.equal(ui.state.reads.length, 0)

const pageSource = await readFile(new URL('../src/js/pages/voiceDetailsPage.js', import.meta.url), 'utf8')
assert.match(pageSource, /createListingReportForm\(listing, \{ userId: currentUser\?\.id \}\)/)
assert.ok(!pageSource.includes('Reporting will be available'))
console.log('Prompt 17 report UI tests passed (accessible form, initial/duplicate/resolved states, valid and invalid reasons, anonymous/forbidden states, loading, retry, safe text and private-data exclusion).')
