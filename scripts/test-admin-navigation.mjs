import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const descendants = (node) => [node, ...node.children.flatMap(descendants)]
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.attributes = new Map()
    this.listeners = new Map()
  }
  set innerHTML(value) { this.html = value; this.children = [] }
  append(...nodes) { this.children.push(...nodes) }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  addEventListener(event, callback) { this.listeners.set(event, callback) }
  querySelector(selector) {
    assert.equal(selector, '[data-admin-link]')
    return descendants(this).find((node) => node.attributes.has('data-admin-link')) ?? null
  }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function setup({ user = null, role = 'user', roleError = null, rolePending = null, active = 'admin' } = {}) {
  const elements = new Map(['navbar', 'navbar-auth-actions', 'navbar-page-links'].map((id) => [`#${id}`, new Element()]))
  const timers = []
  const state = { roleCalls: 0 }
  let auth
  const context = createContext({
    window: { setTimeout: (callback) => timers.push(callback), location: { replace() {} } },
    document: {
      querySelector: (selector) => { assert.ok(elements.has(selector)); return elements.get(selector) },
      createElement: (tag) => new Element(tag),
    },
  })
  const module = new SourceTextModule(await readFile(new URL('../src/js/components/navbar.js', import.meta.url), 'utf8'), { context })
  await module.link(async (specifier) => {
    assert.ok(specifier.endsWith('/authService.js'))
    return new SyntheticModule(['getCurrentUser', 'getCurrentUserRole', 'signOut', 'subscribeToAuthState'], function () {
      this.setExport('getCurrentUser', async () => ({ user, error: null }))
      this.setExport('getCurrentUserRole', async () => { state.roleCalls++; return rolePending ?? { role, error: roleError } })
      this.setExport('signOut', async () => ({ error: null }))
      this.setExport('subscribeToAuthState', (callback) => { auth = callback })
    }, { context })
  })
  await module.evaluate()
  module.namespace.renderNavbar(active)
  await settle()
  return {
    state, links: elements.get('#navbar-page-links'),
    runTimers: () => Promise.all(timers.splice(0).map((callback) => callback())),
    auth: (event, nextUser) => auth({ event, session: nextUser ? { user: nextUser } : null }),
  }
}

let ui = await setup()
await ui.runTimers()
assert.equal(ui.state.roleCalls, 0, 'Anonymous navigation makes no admin-role request')
assert.equal(ui.links.querySelector('[data-admin-link]'), null)

ui = await setup({ user: { id: 'regular-id', user_metadata: { role: 'admin' } }, role: 'user' })
assert.equal(ui.state.roleCalls, 0, 'Role lookup is deferred outside the auth callback')
await ui.runTimers()
assert.equal(ui.state.roleCalls, 1)
assert.equal(ui.links.querySelector('[data-admin-link]'), null, 'Editable metadata cannot grant admin navigation')

ui = await setup({ user: { id: 'admin-id' }, role: 'admin' })
await ui.runTimers()
let link = ui.links.querySelector('[data-admin-link]')
assert.equal(link.textContent, 'Admin')
assert.equal(link.href, '/admin.html')
assert.equal(link.getAttribute('aria-current'), 'page')
assert.match(link.className, /active/)
ui.auth('TOKEN_REFRESHED', { id: 'admin-id' })
await ui.runTimers()
assert.equal(descendants(ui.links).filter((node) => node.attributes.has('data-admin-link')).length, 1)
ui.auth('SIGNED_OUT', null)
assert.equal(ui.links.querySelector('[data-admin-link]'), null)

ui = await setup({ user: { id: 'admin-id' }, role: 'admin', active: 'marketplace' })
await ui.runTimers()
link = ui.links.querySelector('[data-admin-link]')
assert.equal(link.getAttribute('aria-current'), null)
assert.equal(link.className, 'nav-link')

ui = await setup({ user: { id: 'admin-id' }, role: 'admin', roleError: 'Role check failed' })
await ui.runTimers()
assert.equal(ui.links.querySelector('[data-admin-link]'), null, 'Unverified roles never show the link')

const pending = deferred()
ui = await setup({ user: { id: 'admin-id' }, rolePending: pending.promise })
const roleRequest = ui.runTimers()
await settle()
ui.auth('SIGNED_OUT', null)
pending.resolve({ role: 'admin', error: null })
await roleRequest
assert.equal(ui.links.querySelector('[data-admin-link]'), null, 'A delayed role result cannot revive admin navigation after signout')

const switched = deferred()
ui = await setup({ user: { id: 'admin-id' }, rolePending: switched.promise })
const staleRole = ui.runTimers()
await settle()
ui.auth('SIGNED_IN', { id: 'unrelated-id' })
switched.resolve({ role: 'admin', error: null })
await staleRole
assert.equal(ui.links.querySelector('[data-admin-link]'), null, 'A previous account role cannot add admin navigation for another account')

console.log('Admin navigation tests passed: database role only, anonymous/normal denial, active page semantics, duplicate prevention, and stale role rejection after signout/account switch. This is UI coverage, not live database authorization.')
