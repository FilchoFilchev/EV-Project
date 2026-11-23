import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// Exercise UI state and event handlers without Supabase, a browser, or user data.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName
    this.children = []
    this.listeners = new Map()
    this.textContent = ''
    this.value = ''
    this.hidden = true
    this.disabled = false
    this.checked = false
    this.valid = true
  }
  append(...elements) {
    for (const element of elements) {
      if (element.tagName === 'fragment') this.append(...element.children)
      else this.children.push(element)
    }
  }
  replaceChildren(...elements) { this.children = []; this.append(...elements) }
  addEventListener(name, callback) { this.listeners.set(name, callback) }
  setAttribute(name, value) { this[name] = value }
  removeAttribute(name) { delete this[name] }
  focus() { this.focused = true }
  scrollIntoView() {}
  pause() { this.paused = true }
  load() {}
  reset() {}
  reportValidity() { return this.valid }
  async emit(name) { return this.listeners.get(name)?.({ preventDefault() {} }) }
  set innerHTML(value) { throw new Error(`Unsafe HTML: ${value}`) }
}

const elements = new Map()
const element = (name) => {
  const id = `#${name}`
  if (!elements.has(id)) elements.set(id, new Element())
  return elements.get(id)
}
const revoked = []
const preparedCalls = []
const publishedCalls = []
const archivedCalls = []
const title = '<img src=x onerror=alert(1)> Voice'
const version = { versionId: 'owned-version', title, durationSeconds: 12 }
const blob = new Blob(['preview'], { type: 'audio/wav' })
let prepare = async (input) => ({ preview: { ...input, blob, title }, error: null })
let publish = async () => ({ listing: { id: 'listing-1' }, error: null })
let listings = [{
  id: 'listing-1', status: 'published', sale_price_cents: 1234, rental_price_cents: 250,
  preview_path: 'owner/preview.wav',
  version: { effect_type: 'echo', recording: { title, category: '<script>category</script>' } },
}]
let listError = null
let archive = async () => {
  listings = listings.map((listing) => ({ ...listing, status: 'archived' }))
  return { listing: listings[0], error: null }
}
const context = vm.createContext({
  console, Number, Intl, URL: {
    createObjectURL: () => 'blob:short-public-preview',
    revokeObjectURL: (url) => revoked.push(url),
  },
  document: {
    querySelector(id) { return element(id.slice(1)) },
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('fragment'),
  },
  prepareListingPreview: async (input) => { preparedCalls.push(input); return prepare(input) },
  publishVoiceListing: async (input) => { publishedCalls.push(input); return publish(input) },
  listMyListings: async () => ({ listings, error: listError }),
  archiveMyListing: async (id) => { archivedCalls.push(id); return archive(id) },
  getPublicPreviewUrl: (path) => path ? `https://example.invalid/voice-previews/${path}` : null,
})
const source = (await readFile(new URL('../src/js/components/listingPublisher.js', import.meta.url), 'utf8'))
  .replace(/^import \{[\s\S]*?\} from [^\n]+\n/, '')
  .replace('export function initListingPublisher()', 'function initListingPublisher()')
vm.runInContext(`${source}\nglobalThis.publisher = initListingPublisher()`, context)
const publisher = context.publisher
const descendants = (node) => [node, ...node.children.flatMap(descendants)]
const button = (text) => descendants(element('my-listings-list')).find((node) => node.tagName === 'button' && node.textContent === text)

publisher.open({ ...version, durationSeconds: 4.9 })
assert.equal(element('listing-publisher').hidden, true, 'short source must not open publisher')
publisher.open(version)
assert.equal(element('listing-publisher').hidden, false)
assert.ok(element('listing-publisher-title').textContent.startsWith(title), 'untrusted title rendered as text')
assert.equal(element('listing-publish-submit').disabled, true)
assert.equal(element('listing-rental-price').disabled, true)

element('listing-preview-start').value = '10'
await element('listing-generate-preview').emit('click')
assert.equal(preparedCalls.length, 0, 'crop must fit source before downloading')
assert.match(element('listing-publish-error').textContent, /5–8/)
element('listing-preview-start').value = '1'
await element('listing-generate-preview').emit('click')
assert.equal(preparedCalls.length, 1)
assert.equal(preparedCalls[0].versionId, version.versionId)
assert.equal(preparedCalls[0].startSeconds, 1)
assert.equal(preparedCalls[0].durationSeconds, 5)
assert.equal(element('listing-local-preview').src, 'blob:short-public-preview')
assert.equal(element('listing-local-preview').hidden, false)
assert.equal(element('listing-publish-submit').disabled, false)

element('listing-preview-start').value = '2'
await element('listing-preview-start').emit('input')
assert.equal(element('listing-local-preview').hidden, true)
assert.equal(element('listing-publish-submit').disabled, true)
assert.deepEqual(revoked, ['blob:short-public-preview'], 'crop changes release stale preview')
await element('listing-generate-preview').emit('click')

await element('listing-publish-form').emit('submit')
assert.equal(publishedCalls.length, 0)
assert.match(element('listing-publish-error').textContent, /Confirm public/)
element('listing-public-confirmed').checked = true
element('listing-rights-confirmed').checked = true
element('listing-sale-enabled').checked = false
await element('listing-sale-enabled').emit('change')
await element('listing-publish-form').emit('submit')
assert.equal(publishedCalls.length, 0)
assert.match(element('listing-publish-error').textContent, /at least one/)
element('listing-rental-enabled').checked = true
element('listing-rental-price').value = '2,50'
await element('listing-rental-enabled').emit('change')
assert.equal(element('listing-rental-price').required, true)
element('listing-publish-form').valid = false
await element('listing-publish-form').emit('submit')
assert.equal(publishedCalls.length, 0, 'browser form validation blocks incomplete prices')
element('listing-publish-form').valid = true
await element('listing-publish-form').emit('submit')
assert.equal(publishedCalls.length, 1)
assert.equal(publishedCalls[0].salePrice, '')
assert.equal(publishedCalls[0].rentalPrice, '2,50')
assert.equal(publishedCalls[0].rightsConfirmed, true)
assert.equal(publishedCalls[0].publicConfirmed, true)
assert.equal(element('listing-publish-submit').disabled, true, 'success cannot republish stale preview')
assert.match(element('listing-publish-status').textContent, /published/)
assert.equal(element('my-listings-list').children.length, 1)
const listingNodes = descendants(element('my-listings-list'))
assert.ok(listingNodes.some((node) => node.textContent === title))
assert.ok(listingNodes.some((node) => node.textContent.includes('<script>category</script>')))
assert.ok(listingNodes.some((node) => node.textContent.includes('30 days')))
assert.ok(listingNodes.some((node) => node.tagName === 'audio' && node.src.includes('/voice-previews/')))
const previousPlayer = listingNodes.find((node) => node.tagName === 'audio')

await button('Archive listing').emit('click')
assert.equal(archivedCalls.length, 0, 'opening confirmation does not archive')
await button('Keep listing').emit('click')
assert.equal(archivedCalls.length, 0)
await button('Archive listing').emit('click')
archive = async () => ({ listing: null, error: { message: 'Archive denied' } })
await button('Confirm archive').emit('click')
assert.deepEqual(archivedCalls, ['listing-1'])
assert.ok(descendants(element('my-listings-list')).some((node) => node.textContent === 'Archive denied'))
archive = async () => {
  listings = listings.map((row) => ({ ...row, status: 'archived' }))
  return { listing: listings[0], error: null }
}
await button('Confirm archive').emit('click')
assert.equal(button('Archive listing'), undefined)
assert.ok(descendants(element('my-listings-list')).some((node) => node.textContent.includes('archived')))
assert.equal(previousPlayer.paused, true, 'replaced listing previews stop playback')
assert.equal(previousPlayer.src, undefined, 'detached player releases its remote source')

listings = []
await publisher.loadListings()
assert.equal(element('my-listings-empty').hidden, false)
listError = { message: 'Sign in is required' }
await publisher.loadListings()
assert.equal(element('my-listings-error').textContent, listError.message)
assert.equal(element('my-listings-error').hidden, false)
assert.equal(element('my-listings-empty').hidden, true)

publisher.open(version)
let resolvePrepare
prepare = () => new Promise((resolve) => { resolvePrepare = resolve })
const pending = element('listing-generate-preview').emit('click')
assert.equal(element('listing-publish-fields').disabled, true, 'pending work locks the entire form')
publisher.open({ ...version, versionId: 'another-version', title: 'Other' })
assert.ok(element('listing-publisher-title').textContent.startsWith(title), 'pending work cannot switch version')
publisher.dispose()
resolvePrepare({ preview: { blob, durationSeconds: 5 }, error: null })
await pending
assert.equal(element('listing-local-preview').hidden, true, 'pagehide discards late render result')
assert.equal(element('listing-publish-fields').disabled, false)

prepare = async (input) => ({ preview: { ...input, blob }, error: null })
publisher.open(version)
await element('listing-generate-preview').emit('click')
element('listing-public-confirmed').checked = true
element('listing-rights-confirmed').checked = true
element('listing-sale-price').value = '3.00'
publish = async () => ({ listing: null, error: { message: 'Check My listings before retrying.', outcomeUnknown: true } })
await element('listing-publish-form').emit('submit')
assert.equal(element('listing-publish-error').textContent, 'Check My listings before retrying.')
assert.equal(element('listing-publish-submit').disabled, true, 'uncertain publish requires a fresh verified preview')
assert.equal(element('listing-local-preview').hidden, true)

console.log('Listing UI tests passed (preview lifecycle, validation, consent, publishing, safe rendering, listing states, archive confirmation, pending/unknown outcomes).')
