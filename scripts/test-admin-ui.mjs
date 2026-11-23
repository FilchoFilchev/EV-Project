import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

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
  append(...nodes) { this.children.push(...nodes) }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes }
  set textContent(value) { this._text = String(value); this.children = [] }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join('') }
  set innerHTML(value) { throw new Error(`Unsafe insertion: ${value}`) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  addEventListener(event, listener) { this.listeners.set(event, listener) }
  focus() { this.focused = true }
  async dispatch(event, details = {}) { await this.listeners.get(event)?.({ preventDefault() {}, ...details }) }
}
const defer = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { resolve, promise }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const report = {
  id: 'report-id', listing_id: 'listing-id', reporter_id: 'reporter-id',
  reason: '<script>rights concern</script>', status: 'open', listing_title: '<img src=x>',
  created_at: '2026-11-23T12:00:00Z',
}
const listing = { id: 'listing-id', title: '<svg onload=alert(1)>', status: 'published', owner_id: 'owner-id' }
const user = { id: 'user-id', display_name: '<script>user</script>', plan: 'free' }

async function setup(overrides = {}) {
  const ids = ['admin-panel', 'admin-heading', 'admin-status', 'admin-error', 'admin-empty', 'admin-list', 'admin-refresh',
    'admin-tab-reports', 'admin-tab-listings', 'admin-tab-users']
  const elements = new Map(ids.map((id) => [`#${id}`, new Element(id.includes('tab-') || id.endsWith('refresh') ? 'button' : 'div')]))
  const state = {
    data: { reports: [report], listings: [listing], users: [user] },
    calls: [], actionCalls: [], actionResult: { error: null }, ...overrides,
  }
  let onAuth
  const context = createContext({
    console, Date, Intl, Number,
    window: { addEventListener() {} },
    document: {
      createElement: (tag) => new Element(tag),
      querySelector: (id) => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id) },
    },
  })
  const module = new SourceTextModule(await readFile(new URL('../src/js/components/adminPanel.js', import.meta.url), 'utf8'), { context })
  await module.link(async (specifier) => {
    if (specifier.endsWith('/authService.js')) return new SyntheticModule(['subscribeToAuthState'], function () {
      this.setExport('subscribeToAuthState', (callback) => { onAuth = callback; return () => {} })
    }, { context })
    assert.ok(specifier.endsWith('/adminService.js'))
    return new SyntheticModule(['listAdminUsers', 'listAdminListings', 'listAdminReports', 'adminSetPremium', 'adminModerateListing', 'adminResolveReport'], function () {
      for (const tab of ['users', 'listings', 'reports']) {
        const name = `listAdmin${tab[0].toUpperCase()}${tab.slice(1)}`
        this.setExport(name, async () => {
          state.calls.push(tab)
          if (state.throws) throw new Error('Connection failed')
          return state.pending ?? { [tab]: state.data[tab], error: state.error ?? null }
        })
      }
      for (const name of ['adminSetPremium', 'adminModerateListing', 'adminResolveReport']) {
        this.setExport(name, async (...args) => {
          state.actionCalls.push([name, ...args])
          if (state.actionThrows) throw new Error('Connection failed')
          return state.actionPending ?? state.actionResult
        })
      }
    }, { context })
  })
  await module.evaluate()
  const controller = module.namespace.initAdminPanel({ userId: 'admin-id' })
  return { controller, state, get: (id) => elements.get(`#${id}`), auth: (value) => onAuth(value) }
}
const action = (ui, label) => descendants(ui.get('admin-list')).find((node) => node.tagName === 'button' && node.textContent === label)

let ui = await setup()
assert.equal(ui.state.calls.length, 0, 'Initialization alone does not bypass the page guard')
await ui.controller.load()
assert.equal(ui.get('admin-list').children.length, 1)
assert.equal(ui.get('admin-error').hidden, true)
assert.equal(ui.get('admin-empty').hidden, true)
assert.match(ui.get('admin-list').textContent, /<script>rights concern<\/script>/)
assert.match(ui.get('admin-list').textContent, /Reporter ID: reporter-id/)
assert.ok(!descendants(ui.get('admin-list')).some((node) => ['audio', 'script', 'img'].includes(node.tagName)), 'No untrusted HTML or private audio rendered')
await action(ui, 'Resolve report').dispatch('click')
assert.deepEqual(ui.state.actionCalls, [['adminResolveReport', 'report-id']])
assert.match(ui.get('admin-status').textContent, /Report resolved/)
assert.equal(ui.state.calls.length, 2, 'Successful action refreshes authoritative data')

await ui.controller.load('listings')
assert.equal(ui.get('admin-tab-listings').getAttribute('aria-selected'), 'true')
assert.equal(ui.get('admin-tab-reports').getAttribute('aria-selected'), 'false')
assert.equal(ui.get('admin-panel').getAttribute('aria-labelledby'), 'admin-tab-listings')
assert.equal(ui.get('admin-tab-listings').tabIndex, 0)
assert.equal(ui.get('admin-tab-reports').tabIndex, -1)
await action(ui, 'Archive listing').dispatch('click')
assert.deepEqual(ui.state.actionCalls.at(-1), ['adminModerateListing', 'listing-id', 'archived'])
assert.match(ui.get('admin-status').textContent, /Existing licenses are preserved/)
ui.state.data.listings = [{ ...listing, status: 'archived' }, { ...listing, id: 'draft-id', status: 'draft' }]
await ui.controller.load('listings')
await action(ui, 'Restore listing').dispatch('click')
assert.deepEqual(ui.state.actionCalls.at(-1), ['adminModerateListing', 'listing-id', 'published'])
assert.match(ui.get('admin-list').textContent, /Only its owner can publish/)

await ui.controller.load('users')
await action(ui, 'Set demo Premium (30 days)').dispatch('click')
assert.deepEqual(ui.state.actionCalls.at(-1), ['adminSetPremium', 'user-id', 'premium'])
await action(ui, 'Set Free').dispatch('click')
assert.deepEqual(ui.state.actionCalls.at(-1), ['adminSetPremium', 'user-id', 'free'])
assert.ok(!descendants(ui.get('admin-list')).some((node) => ['input', 'textarea', 'select'].includes(node.tagName)), 'Profiles remain read-only')
await ui.get('admin-tab-users').dispatch('keydown', { key: 'Home' })
await settle()
assert.equal(ui.get('admin-tab-reports').focused, true)
assert.equal(ui.get('admin-tab-reports').getAttribute('aria-selected'), 'true')

const pending = defer()
ui = await setup({ pending: pending.promise })
const loading = ui.controller.load()
await settle()
assert.match(ui.get('admin-status').textContent, /Loading reports/)
assert.equal(ui.get('admin-refresh').disabled, true)
assert.equal(ui.get('admin-list').getAttribute('aria-busy'), 'true')
await ui.controller.load()
assert.equal(ui.state.calls.length, 1)
pending.resolve({ reports: [], error: null })
await loading
assert.equal(ui.get('admin-empty').hidden, false)
assert.equal(ui.get('admin-refresh').disabled, false)
assert.equal(ui.get('admin-list').getAttribute('aria-busy'), 'false')

const actionPending = defer()
ui = await setup({ actionPending: actionPending.promise })
await ui.controller.load()
const resolveButton = action(ui, 'Resolve report')
const saving = resolveButton.dispatch('click')
await settle()
assert.equal(resolveButton.disabled, true)
assert.equal(ui.get('admin-tab-users').disabled, true)
await resolveButton.dispatch('click')
assert.equal(ui.state.actionCalls.length, 1, 'Duplicate actions are suppressed')
actionPending.resolve({ error: null })
await saving
assert.equal(ui.get('admin-tab-users').disabled, false)

for (const code of ['access_denied', 'authentication_required', 'network_error']) {
  ui = await setup({ error: { code, message: `<script>${code}</script>` } })
  await ui.controller.load()
  assert.equal(ui.get('admin-error').hidden, false)
  assert.equal(ui.get('admin-error').textContent, `<script>${code}</script>`)
  assert.equal(ui.get('admin-list').children.length, 0)
  assert.equal(ui.get('admin-refresh').disabled, code !== 'network_error')
}
ui = await setup({ throws: true })
await ui.controller.load()
assert.match(ui.get('admin-error').textContent, /could not be loaded/)
assert.equal(ui.get('admin-refresh').disabled, false)

ui = await setup({ actionThrows: true })
await ui.controller.load()
await action(ui, 'Resolve report').dispatch('click')
assert.match(ui.get('admin-error').textContent, /Refresh to check its status/)
assert.equal(ui.get('admin-refresh').disabled, false)

ui = await setup({ actionResult: { error: { code: 'access_denied', message: 'Admin access required.' } } })
await ui.controller.load()
await action(ui, 'Resolve report').dispatch('click')
assert.equal(ui.get('admin-list').children.length, 0)
assert.equal(ui.get('admin-error').textContent, 'Admin access required.')
assert.equal(ui.get('admin-refresh').disabled, true)
await ui.controller.load('users')
assert.equal(ui.state.calls.length, 1, 'Revoked access blocks further requests')

const stale = defer()
ui = await setup({ pending: stale.promise })
const staleLoading = ui.controller.load()
await settle()
ui.state.pending = null
await ui.controller.load('users')
stale.resolve({ reports: [report], error: null })
await staleLoading
assert.match(ui.get('admin-list').textContent, /User ID: user-id/)
assert.ok(!ui.get('admin-list').textContent.includes('Reporter ID:'), 'Late tab responses cannot overwrite the selected tab')

ui = await setup({ data: { reports: [{ ...report, status: 'resolved', resolved_at: '2026-11-23T13:00:00Z' }] } })
await ui.controller.load()
assert.equal(action(ui, 'Resolve report'), undefined)
assert.match(ui.get('admin-list').textContent, /Resolved:/)
ui.auth({ event: 'SIGNED_IN', user: { id: 'other-user' } })
assert.equal(ui.get('admin-list').children.length, 0)
assert.equal(ui.get('admin-refresh').disabled, true)
assert.match(ui.get('admin-status').textContent, /Reload this page/)

const page = await readFile(new URL('../src/js/pages/adminPage.js', import.meta.url), 'utf8')
assert.match(page, /const user = await requireAdmin\(\)/)
assert.match(page, /if \(user\) await initAdminPanel\(/)
console.log('Admin UI tests passed: guarded initialization, report resolution, archive/restore, Premium/free, safe text, keyboard tabs, loading, duplicate actions, empty/error/forbidden, and account-change clearing. Actual database authorization requires the separate SQL suite.')
